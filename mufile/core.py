"""mufile core – shared logic for crop, convert, movie. Used by CLI and GUI."""

from __future__ import annotations

import csv
import re
from collections.abc import Callable
from pathlib import Path

import numpy as np
import tifffile
import zarr

ProgressCallback = Callable[[float, str], None]


def _draw_marker(
    frame: np.ndarray, y: int, x: int, h: int, w: int, size: int = 1
) -> None:
    """Draw a white diagonal cross (X) at (y, x), overwriting pixels."""
    white = 255 if len(frame.shape) == 2 else np.array([255, 255, 255], dtype=np.uint8)
    for d in range(-size, size + 1):
        for yy, xx in [(y + d, x + d), (y + d, x - d)]:
            if 0 <= yy < h and 0 <= xx < w:
                frame[yy, xx] = white


_TIFF_RE = re.compile(r"img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif")


def _discover_tiffs(pos_dir: Path) -> dict[tuple[int, int, int], Path]:
    """Return {(channel, time, z): path} for every TIFF in *pos_dir*."""
    index: dict[tuple[int, int, int], Path] = {}
    for p in sorted(pos_dir.iterdir()):
        m = _TIFF_RE.match(p.name)
        if m is None:
            continue
        c, _pos, t, z = (int(g) for g in m.groups())
        index[(c, t, z)] = p
    return index


def _axis_range(index: dict[tuple[int, int, int], Path]) -> tuple[int, int, int]:
    """Return (n_channels, n_times, n_z) from the discovered index."""
    cs = {k[0] for k in index}
    ts = {k[1] for k in index}
    zs = {k[2] for k in index}
    return len(cs), len(ts), len(zs)


def _read_bbox_csv(csv_path: Path) -> list[dict[str, int]]:
    """Parse the mupattern bbox CSV -> list of {crop, x, y, w, h}."""
    rows: list[dict[str, int]] = []
    with open(csv_path, newline="") as fh:
        for row in csv.DictReader(fh):
            rows.append({k: int(v) for k, v in row.items()})
    return rows


def parse_slice_string(s: str, length: int) -> list[int]:
    """Parse a human-friendly slice string into a sorted list of unique indices.

    Accepts "all" or comma-separated mix of integers and slices. Raises ValueError on invalid input.
    """
    if s.strip().lower() == "all":
        return list(range(length))

    indices: set[int] = set()
    for segment in s.split(","):
        segment = segment.strip()
        if not segment:
            continue
        try:
            if ":" in segment:
                parts = [(int(p) if p else None) for p in segment.split(":")]
                if len(parts) == 3 and parts[2] == 0:
                    raise ValueError(f"Slice step cannot be zero: {segment!r}")
                indices.update(range(*slice(*parts).indices(length)))
            else:
                idx = int(segment)
                if idx < -length or idx >= length:
                    raise ValueError(f"Index {idx} out of range for length {length}")
                indices.add(idx % length)
        except ValueError as e:
            if "out of range" in str(e) or "cannot be zero" in str(e):
                raise
            raise ValueError(f"Invalid slice segment: {segment!r}") from e

    if not indices:
        raise ValueError(f"Slice string {s!r} produced no indices")

    return sorted(indices)


def run_crop(
    input_dir: Path,
    pos: int,
    bbox: Path,
    output: Path,
    background: bool = False,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Crop pattern positions from microscopy TIFFs into a zarr store."""
    pos_dir = input_dir / f"Pos{pos}"
    if not pos_dir.is_dir():
        raise FileNotFoundError(f"Position directory not found: {pos_dir}")

    bboxes = _read_bbox_csv(bbox)

    index = _discover_tiffs(pos_dir)
    if not index:
        raise ValueError(f"No TIFFs found in {pos_dir}")

    n_channels, n_times, n_z = _axis_range(index)
    if on_progress:
        on_progress(0.0, f"Discovered {len(index)} TIFFs: T={n_times}, C={n_channels}, Z={n_z}")

    sample = tifffile.imread(next(iter(index.values())))
    dtype = sample.dtype

    store = zarr.DirectoryStore(str(output))
    root = zarr.open_group(store, mode="a")
    crop_grp = root.require_group(f"pos/{pos:03d}/crop")

    n_crops = len(bboxes)
    if on_progress:
        on_progress(0.0, f"Cropping {n_crops} crops ...")

    arrays: list[zarr.Array] = []
    for i, bb in enumerate(bboxes):
        arr = crop_grp.zeros(
            f"{i:03d}",
            shape=(n_times, n_channels, n_z, bb["h"], bb["w"]),
            chunks=(1, 1, 1, bb["h"], bb["w"]),
            dtype=dtype,
            overwrite=True,
        )
        arr.attrs["axis_names"] = ["t", "c", "z", "y", "x"]
        arr.attrs["bbox"] = bb
        arrays.append(arr)

    bg_arr = None
    if background:
        mask = np.zeros(sample.shape, dtype=bool)
        for bb in bboxes:
            x, y, w, h = bb["x"], bb["y"], bb["w"], bb["h"]
            mask[y : y + h, x : x + w] = True

        bg_arr = root.zeros(
            f"pos/{pos:03d}/background",
            shape=(n_times, n_channels, n_z),
            chunks=(1, 1, 1),
            dtype=np.float64,
            overwrite=True,
        )
        bg_arr.attrs["axis_names"] = ["t", "c", "z"]
        bg_arr.attrs["description"] = "Median of pixels outside all crop bounding boxes"

    sorted_keys = sorted(index.keys())
    total = len(sorted_keys)
    for i, (c, t, z) in enumerate(sorted_keys):
        frame = tifffile.imread(index[(c, t, z)])
        for crop_idx, bb in enumerate(bboxes):
            x, y, w, h = bb["x"], bb["y"], bb["w"], bb["h"]
            arrays[crop_idx][t, c, z] = frame[y : y + h, x : x + w]
        if bg_arr is not None:
            bg_arr[t, c, z] = float(np.median(frame[~mask]))

        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Reading frames {i + 1}/{total}")

    if on_progress:
        on_progress(1.0, f"Wrote {output}")


def run_convert(
    input_nd2: Path,
    pos_slice: str,
    time_slice: str,
    output: Path,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Convert an ND2 file into per-position TIFF folders."""
    import nd2

    f = nd2.ND2File(str(input_nd2))
    sizes = f.sizes
    n_pos = sizes.get("P", 1)
    n_time = sizes.get("T", 1)
    n_chan = sizes.get("C", 1)
    n_z = sizes.get("Z", 1)

    dim_order = [d for d in sizes.keys() if d not in ("Y", "X")]
    dask_arr = f.to_dask()

    pos_names: list[str | None] = []
    try:
        exp = f.experiment
        if exp:
            for loop in exp:
                if loop.type == "XYPosLoop":
                    pos_names = [p.name for p in loop.parameters.points]
                    break
    except Exception:
        pass

    pos_names = [
        name if name else f"Pos{i}"
        for i, name in enumerate(pos_names)
    ] or [f"Pos{i}" for i in range(n_pos)]

    def _pos_number(name: str) -> int:
        m = re.search(r"(\d+)", name)
        return int(m.group(1)) if m else 0

    pos_indices = parse_slice_string(pos_slice, n_pos)
    time_indices = parse_slice_string(time_slice, n_time)

    total = len(pos_indices) * len(time_indices) * n_chan * n_z
    if on_progress:
        on_progress(
            0.0,
            f"Selected {len(pos_indices)} positions, {len(time_indices)} timepoints, "
            f"{n_chan} channels, {n_z} z-slices. Total frames: {total}",
        )

    output.mkdir(parents=True, exist_ok=True)

    done = 0
    for p_idx in pos_indices:
        pos_name = pos_names[p_idx]
        pos_num = _pos_number(pos_name)
        pos_dir = output / pos_name
        pos_dir.mkdir(exist_ok=True)

        with open(pos_dir / "time_map.csv", "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["t", "t_real"])
            for t_new, t_orig in enumerate(time_indices):
                writer.writerow([t_new, t_orig])

        for t_new, t_orig in enumerate(time_indices):
            for c in range(n_chan):
                for z in range(n_z):
                    coords = {"P": p_idx, "T": t_orig, "C": c, "Z": z}
                    idx = tuple(coords.get(d, 0) for d in dim_order)
                    frame = dask_arr[idx].compute()

                    fname = (
                        f"img_channel{c:03d}"
                        f"_position{pos_num:03d}"
                        f"_time{t_new:09d}"
                        f"_z{z:03d}.tif"
                    )
                    tifffile.imwrite(str(pos_dir / fname), frame)
                    done += 1

                    if on_progress and total > 0:
                        on_progress(done / total, f"Writing TIFFs {done}/{total}")

    f.close()
    if on_progress:
        on_progress(1.0, f"Wrote {output}")


def run_movie(
    input_zarr: Path,
    pos: int,
    crop_idx: int,
    channel: int,
    time_slice: str,
    output: Path,
    fps: int,
    colormap: str,
    spots_path: Path | None = None,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Create a movie from a zarr crop."""
    import imageio
    import matplotlib.cm as cm

    store = zarr.DirectoryStore(str(input_zarr))
    root = zarr.open_group(store, mode="r")
    crop_grp = root[f"pos/{pos:03d}/crop"]
    crop_id = f"{crop_idx:03d}"

    if crop_id not in crop_grp:
        raise ValueError(f"Crop {crop_id} not found in position {pos:03d}")

    arr = crop_grp[crop_id]
    n_times = arr.shape[0]
    n_channels = arr.shape[1]

    if channel >= n_channels:
        raise ValueError(
            f"Channel {channel} out of range (0-{n_channels - 1})"
        )

    time_indices = parse_slice_string(time_slice, n_times)

    spots_by_t_crop: dict[tuple[int, str], list[tuple[float, float]]] = {}
    if spots_path is not None:
        with open(spots_path, newline="") as fh:
            for row in csv.DictReader(fh):
                t_val = int(row["t"])
                c = row["crop"]
                y_val = float(row["y"])
                x_val = float(row["x"])
                key = (t_val, c)
                spots_by_t_crop.setdefault(key, []).append((y_val, x_val))

    frames_raw = []
    for i, t in enumerate(time_indices):
        frame = np.array(arr[t, channel, 0])
        frames_raw.append(frame)
        if on_progress:
            n = len(time_indices)
            on_progress((i + 1) / n * 0.4, f"Reading frames {i + 1}/{n}")

    if not frames_raw:
        raise ValueError("No frames to write")

    global_min = float(min(f.min() for f in frames_raw))
    global_max = float(max(f.max() for f in frames_raw))

    if colormap == "grayscale":
        cmap = None
    else:
        cmap = cm.get_cmap(colormap)

    frames = []
    for frame in frames_raw:
        if global_max > global_min:
            normalized = (frame - global_min) / (global_max - global_min)
        else:
            normalized = np.zeros_like(frame, dtype=np.float64)

        if cmap is None:
            frame_uint8 = (normalized * 255).astype(np.uint8)
        else:
            colored = cmap(normalized)
            frame_uint8 = (colored[:, :, :3] * 255).astype(np.uint8)

        frames.append(frame_uint8)

    if spots_path is not None and spots_by_t_crop:
        for i, t_val in enumerate(time_indices):
            key = (t_val, crop_id)
            spot_list = spots_by_t_crop.get(key)
            if spot_list is None:
                continue
            frame = frames[i]
            h, w = frame.shape[0], frame.shape[1]
            for y_f, x_f in spot_list:
                y_p, x_p = int(round(y_f)), int(round(x_f))
                _draw_marker(frame, y_p, x_p, h, w)

    if frames:
        if len(frames[0].shape) == 2:
            h, w = frames[0].shape
            pad_h = (16 - (h % 16)) % 16
            pad_w = (16 - (w % 16)) % 16
        else:
            h, w, _ = frames[0].shape
            pad_h = (16 - (h % 16)) % 16
            pad_w = (16 - (w % 16)) % 16
        if pad_h > 0 or pad_w > 0:
            pads = (
                ((0, pad_h), (0, pad_w))
                if len(frames[0].shape) == 2
                else ((0, pad_h), (0, pad_w), (0, 0))
            )
            frames = [
                np.pad(f, pads, mode="constant", constant_values=0) for f in frames
            ]

    output.parent.mkdir(parents=True, exist_ok=True)

    imageio.mimwrite(
        str(output),
        frames,
        fps=fps,
        codec="libx264",
        pixelformat="yuv420p",
        ffmpeg_params=["-preset", "slow", "-crf", "15"],
    )

    if on_progress:
        on_progress(1.0, f"Wrote movie to {output}")

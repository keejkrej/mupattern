"""mufile – microscopy file utilities.

Commands:

* ``mufile crop``    — crop micropattern positions from TIFFs into zarr stacks.
* ``mufile convert`` — convert an ND2 file into per-position TIFF folders.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Annotated

import numpy as np
import tifffile
import typer
import zarr
from rich.progress import track

app = typer.Typer(add_completion=False)


# ---------------------------------------------------------------------------
# Helpers (crop)
# ---------------------------------------------------------------------------

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


def _crop_position(
    pos_dir: Path,
    pos: int,
    bboxes: list[dict[str, int]],
    output: Path,
    background: bool = False,
) -> None:
    """Crop every bbox across all frames and write into *output* zarr store."""
    index = _discover_tiffs(pos_dir)
    if not index:
        raise typer.BadParameter(f"No TIFFs found in {pos_dir}")

    n_channels, n_times, n_z = _axis_range(index)
    typer.echo(f"Discovered {len(index)} TIFFs: T={n_times}, C={n_channels}, Z={n_z}")

    sample = tifffile.imread(next(iter(index.values())))
    dtype = sample.dtype

    store = zarr.DirectoryStore(str(output))
    root = zarr.open_group(store, mode="a")
    crop_grp = root.require_group(f"pos/{pos:03d}/crop")

    n_crops = len(bboxes)
    typer.echo(f"Cropping {n_crops} crops ...")

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
    for c, t, z in track(sorted_keys, description="Reading frames"):
        frame = tifffile.imread(index[(c, t, z)])
        for crop_idx, bb in enumerate(bboxes):
            x, y, w, h = bb["x"], bb["y"], bb["w"], bb["h"]
            arrays[crop_idx][t, c, z] = frame[y : y + h, x : x + w]
        if bg_arr is not None:
            bg_arr[t, c, z] = float(np.median(frame[~mask]))

    typer.echo(f"Wrote {output}")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


@app.command()
def crop(
    input_dir: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            file_okay=False,
            help="Root folder containing Pos* subdirectories.",
        ),
    ],
    pos: Annotated[
        int,
        typer.Option(help="Position number (e.g. 150 reads Pos150/)."),
    ],
    bbox: Annotated[
        Path,
        typer.Option(
            exists=True,
            dir_okay=False,
            help="Path to the bounding-box CSV exported by mupattern.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output zarr store path (e.g. crops.zarr)."),
    ],
    background: Annotated[
        bool,
        typer.Option(help="Compute per-frame background (median outside crops)."),
    ] = False,
) -> None:
    """Crop pattern positions from microscopy TIFFs into a zarr store."""
    pos_dir = input_dir / f"Pos{pos}"
    if not pos_dir.is_dir():
        typer.echo(f"Error: Position directory not found: {pos_dir}", err=True)
        raise typer.Exit(code=1)

    bboxes = _read_bbox_csv(bbox)
    typer.echo(f"Loaded {len(bboxes)} bounding boxes from {bbox}")

    _crop_position(pos_dir, pos, bboxes, output, background=background)


@app.command()
def convert(
    nd2_file: Annotated[
        Path,
        typer.Argument(
            exists=True,
            dir_okay=False,
            help="Path to the .nd2 file to convert.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output directory (will contain Pos*/... TIFF folders)."),
    ] = None,
) -> None:
    """Convert an ND2 file into per-position TIFF folders.

    Output layout::

        output/
          Pos140/
            img_channel000_position140_time000000000_z000.tif
          Pos150/
            ...
    """
    import nd2

    if output is None:
        output = nd2_file.parent / nd2_file.stem

    f = nd2.ND2File(str(nd2_file))
    sizes = f.sizes
    n_pos = sizes.get("P", 1)
    n_time = sizes.get("T", 1)
    n_chan = sizes.get("C", 1)
    n_z = sizes.get("Z", 1)

    # Build dimension order for indexing (excludes Y, X)
    dim_order = [d for d in sizes.keys() if d not in ("Y", "X")]
    dask_arr = f.to_dask()

    # Get position names from ND2 metadata (e.g. "Pos140", "Pos150")
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

    # Fill in missing names with Pos0, Pos1, ...
    pos_names = [
        name if name else f"Pos{i}"
        for i, name in enumerate(pos_names)
    ] or [f"Pos{i}" for i in range(n_pos)]

    # Extract position number from name (e.g. "Pos140" -> 140)
    def _pos_number(name: str) -> int:
        m = re.search(r"(\d+)", name)
        return int(m.group(1)) if m else 0

    total = n_pos * n_time * n_chan * n_z
    typer.echo(
        f"ND2: {n_pos} positions, T={n_time}, C={n_chan}, Z={n_z} "
        f"({total} frames total)"
    )
    typer.echo(f"Positions: {', '.join(pos_names)}")

    output.mkdir(parents=True, exist_ok=True)

    with typer.progressbar(length=total, label="Writing TIFFs") as progress:
        for p_idx in range(n_pos):
            pos_name = pos_names[p_idx]
            pos_num = _pos_number(pos_name)
            pos_dir = output / pos_name
            pos_dir.mkdir(exist_ok=True)

            for t in range(n_time):
                for c in range(n_chan):
                    for z in range(n_z):
                        coords = {"P": p_idx, "T": t, "C": c, "Z": z}
                        idx = tuple(coords.get(d, 0) for d in dim_order)
                        frame = dask_arr[idx].compute()

                        fname = (
                            f"img_channel{c:03d}"
                            f"_position{pos_num:03d}"
                            f"_time{t:09d}"
                            f"_z{z:03d}.tif"
                        )
                        tifffile.imwrite(str(pos_dir / fname), frame)
                        progress.update(1)

    f.close()
    typer.echo(f"Wrote {output}")


if __name__ == "__main__":
    app()

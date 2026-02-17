"""mutissue core – segment crops with Cellpose v4 or fluo-only watershed, measure per-cell fluorescence. Used by CLI and API."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import zarr
from scipy import ndimage
from skimage.segmentation import watershed

from ...common.progress import ProgressCallback


def _segment_frame_peaks(
    fluo: np.ndarray,
    *,
    sigma: float = 2.0,
    min_distance: int = 5,
    min_intensity: float = 0.0,
) -> np.ndarray:
    """Segment a single frame using fluorescence local maxima + Voronoi. Returns uint32 mask (0=bg, 1..N=cells)."""
    fluo = np.asarray(fluo, dtype=np.float64)
    if sigma > 0:
        fluo = ndimage.gaussian_filter(fluo, sigma=sigma, mode="nearest")
    size = max(3, 2 * min_distance + 1)
    max_filtered = ndimage.maximum_filter(fluo, size=size, mode="nearest")
    peak_mask = (fluo >= max_filtered) & (fluo > min_intensity)
    # One pixel per peak: label connected plateau, then take centroid per component
    labeled_plateaus, n_plateaus = ndimage.label(peak_mask)
    if n_plateaus == 0:
        return np.zeros(fluo.shape, dtype=np.uint32)
    seed_label = np.zeros(fluo.shape, dtype=np.int32)
    for i in range(1, n_plateaus + 1):
        ys, xs = np.where(labeled_plateaus == i)
        # use pixel with max intensity in this plateau as seed
        idx = np.argmax(fluo[ys, xs])
        sy, sx = int(ys[idx]), int(xs[idx])
        seed_label[sy, sx] = i
    seed_binary = seed_label > 0
    _, indices = ndimage.distance_transform_edt(~seed_binary, return_indices=True)
    labels = seed_label[indices[0], indices[1]]
    return np.asarray(labels, dtype=np.uint32)


def _segment_frame_watershed(
    fluo: np.ndarray,
    background: float,
    *,
    sigma: float = 2.0,
    margin: float = 0.0,
    min_distance: int = 5,
) -> np.ndarray:
    """Blur, threshold with background; watershed on foreground only. Returns uint32 mask (0=bg, 1..N=nuclei)."""
    fluo = np.asarray(fluo, dtype=np.float64)
    if sigma > 0:
        fluo = ndimage.gaussian_filter(fluo, sigma=sigma, mode="nearest")
    foreground = fluo > (background + margin)
    if not np.any(foreground):
        return np.zeros(fluo.shape, dtype=np.uint32)
    dist = ndimage.distance_transform_edt(foreground)
    size = max(3, 2 * min_distance + 1)
    max_dist = ndimage.maximum_filter(dist, size=size, mode="nearest")
    peak_mask = (dist >= max_dist) & (dist > 0.5)
    markers, n_seeds = ndimage.label(peak_mask)
    if n_seeds == 0:
        return np.zeros(fluo.shape, dtype=np.uint32)
    ws = watershed(-dist, markers, mask=foreground)
    return np.asarray(ws, dtype=np.uint32)


def run_segment_watershed(
    zarr_path: Path,
    pos: int,
    channel_fluorescence: int,
    output_masks: Path,
    *,
    sigma: float = 2.0,
    margin: float = 0.0,
    min_distance: int = 5,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Segment each crop per frame: blur, threshold with background (or median of frame), watershed on foreground. Same masks.zarr layout."""
    store = zarr.DirectoryStore(str(zarr_path))
    root = zarr.open_group(store, mode="r")
    pos_grp = root[f"pos/{pos:03d}"]
    crop_grp = pos_grp["crop"]
    crop_ids = sorted(crop_grp.keys())
    try:
        bg_arr = pos_grp["background"]
    except KeyError:
        bg_arr = None

    out_store = zarr.DirectoryStore(str(output_masks))
    out_root = zarr.open_group(out_store, mode="a")
    out_pos_grp = out_root.require_group(f"pos/{pos:03d}")
    mask_crop_grp = out_pos_grp.require_group("crop")

    n_crops = len(crop_ids)
    total_work = sum(int(crop_grp[cid].shape[0]) for cid in crop_ids)
    done = 0

    for crop_idx, crop_id in enumerate(crop_ids):
        arr = crop_grp[crop_id]
        n_times, _, _, h, w = arr.shape
        mask_arr = mask_crop_grp.zeros(
            crop_id,
            shape=(n_times, h, w),
            chunks=(1, h, w),
            dtype=np.uint32,
            overwrite=True,
        )
        mask_arr.attrs["axis_names"] = ["t", "y", "x"]

        for t in range(n_times):
            fluo = np.array(arr[t, channel_fluorescence, 0], dtype=np.float64)
            if bg_arr is not None:
                background = float(bg_arr[t, channel_fluorescence, 0])
            else:
                background = float(np.median(fluo))
            masks = _segment_frame_watershed(
                fluo,
                background,
                sigma=sigma,
                margin=margin,
                min_distance=min_distance,
            )
            mask_arr[t] = masks

            done += 1
            if on_progress and total_work > 0:
                on_progress(done / total_work, f"Crop {crop_idx + 1}/{n_crops}, frame {t + 1}/{n_times}")

    if on_progress:
        on_progress(1.0, "Done")


def run_segment(
    zarr_path: Path,
    pos: int,
    channel_phase: int,
    channel_fluorescence: int,
    output_masks: Path,
    *,
    backend: str = "cellpose",
    on_progress: ProgressCallback | None = None,
) -> None:
    """Segment each crop per frame with Cellpose or CellSAM (phase + fluorescence), save masks to masks.zarr (same layout as crops)."""
    store = zarr.DirectoryStore(str(zarr_path))
    root = zarr.open_group(store, mode="r")
    crop_grp = root[f"pos/{pos:03d}/crop"]
    crop_ids = sorted(crop_grp.keys())

    if backend == "cellpose":
        from cellpose.models import CellposeModel

        try:
            model = CellposeModel(pretrained_model="cpsam", gpu=True)
        except Exception:
            model = CellposeModel(pretrained_model="cpsam", gpu=False)
    elif backend == "cellsam":
        import torch

        from cellSAM import get_model, segment_cellular_image

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = get_model()
        model = model.to(device)
        model.eval()
    else:
        raise ValueError(f"Unknown segment backend {backend!r}. Use 'cellpose' or 'cellsam'.")

    out_store = zarr.DirectoryStore(str(output_masks))
    out_root = zarr.open_group(out_store, mode="a")
    pos_grp = out_root.require_group(f"pos/{pos:03d}")
    mask_crop_grp = pos_grp.require_group("crop")

    n_crops = len(crop_ids)
    total_work = sum(int(crop_grp[cid].shape[0]) for cid in crop_ids)
    done = 0

    for crop_idx, crop_id in enumerate(crop_ids):
        arr = crop_grp[crop_id]
        n_times, _, _, h, w = arr.shape
        mask_arr = mask_crop_grp.zeros(
            crop_id,
            shape=(n_times, h, w),
            chunks=(1, h, w),
            dtype=np.uint32,
            overwrite=True,
        )
        mask_arr.attrs["axis_names"] = ["t", "y", "x"]

        for t in range(n_times):
            phase = np.array(arr[t, channel_phase, 0], dtype=np.float32)
            fluo = np.array(arr[t, channel_fluorescence, 0], dtype=np.float32)
            image = np.stack([phase, fluo, phase], axis=-1)

            if backend == "cellpose":
                masks_list, *_ = model.eval(
                    [image],
                    channel_axis=-1,
                    batch_size=1,
                    normalize=True,
                )
                masks = masks_list[0] if isinstance(masks_list, list) else masks_list
            else:
                mask, _, _ = segment_cellular_image(
                    image, model=model, normalize=True, device=device
                )
                masks = np.asarray(mask, dtype=np.uint32)

            mask_arr[t] = np.asarray(masks, dtype=np.uint32)

            done += 1
            if on_progress and total_work > 0:
                on_progress(done / total_work, f"Crop {crop_idx + 1}/{n_crops}, frame {t + 1}/{n_times}")

    if on_progress:
        on_progress(1.0, "Done")


def run_analyze(
    zarr_path: Path,
    masks_path: Path,
    pos: int,
    channel_fluorescence: int,
    output: Path,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Load crops.zarr and masks.zarr; compute per-cell total fluorescence, cell area, background; write CSV."""
    crop_store = zarr.DirectoryStore(str(zarr_path))
    crop_root = zarr.open_group(crop_store, mode="r")
    pos_grp = crop_root[f"pos/{pos:03d}"]
    crop_grp = pos_grp["crop"]
    crop_ids = sorted(crop_grp.keys())
    try:
        bg_arr = pos_grp["background"]
    except KeyError:
        bg_arr = None  # missing → background 0

    mask_store = zarr.DirectoryStore(str(masks_path))
    mask_root = zarr.open_group(mask_store, mode="r")
    mask_crop_grp = mask_root[f"pos/{pos:03d}/crop"]

    rows: list[tuple[int, str, int, float, int, float]] = []
    n_crops = len(crop_ids)
    total_work = sum(int(crop_grp[cid].shape[0]) for cid in crop_ids)
    done = 0

    for crop_idx, crop_id in enumerate(crop_ids):
        crop_arr = crop_grp[crop_id]
        mask_arr = mask_crop_grp[crop_id]
        n_times = crop_arr.shape[0]
        for t in range(n_times):
            fluo = np.array(crop_arr[t, channel_fluorescence, 0], dtype=np.float64)
            masks = np.array(mask_arr[t])
            if bg_arr is not None:
                background = float(bg_arr[t, channel_fluorescence, 0])
            else:
                background = float(np.median(fluo))
            for cell_id in np.unique(masks):
                if cell_id == 0:
                    continue
                cell_mask = masks == cell_id
                total_fluorescence = float(np.sum(fluo[cell_mask]))
                cell_area = int(np.sum(cell_mask))
                rows.append((t, crop_id, int(cell_id), total_fluorescence, cell_area, background))
            done += 1
            if on_progress and total_work > 0:
                on_progress(done / total_work, f"Crop {crop_idx + 1}/{n_crops}, frame {t + 1}/{n_times}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,cell,total_fluorescence,cell_area,background\n")
        for t, crop, cell, total_fluorescence, cell_area, background in rows:
            fh.write(f"{t},{crop},{cell},{total_fluorescence},{cell_area},{background}\n")

    if on_progress:
        on_progress(1.0, f"Wrote {len(rows)} rows to {output}")


def run_plot(input_csv: Path, output_dir: Path, gfp_threshold: float) -> None:
    """Plot GFP+ count and median (total − area×background) per crop over time. All crop traces in grey; red trace = median across crops. Writes two square plots into output_dir: gfp_count.png and median_fluorescence.png. For accurate total fluorescence use the expression module."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import MaxNLocator

    import pandas as pd

    def _style_ax(ax: plt.Axes) -> None:
        ax.xaxis.set_major_locator(MaxNLocator(nbins=4))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=4))
        ax.tick_params(axis="both", labelsize=12)
        ax.set_xlabel(ax.get_xlabel(), fontsize=14)
        ax.set_ylabel(ax.get_ylabel(), fontsize=14)
        ax.set_title(ax.get_title(), fontsize=16)

    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    count_path = output_dir / "gfp_count.png"
    fluo_path = output_dir / "median_fluorescence.png"

    df = pd.read_csv(input_csv, dtype={"crop": str})
    df["mean_above_bg"] = (df["total_fluorescence"] / df["cell_area"]) - df["background"]
    df["fluo_above_bg"] = df["total_fluorescence"] - df["cell_area"] * df["background"]
    gfp = df[df["mean_above_bg"] > gfp_threshold]
    crops = sorted(gfp["crop"].unique())
    size = 6  # squareish
    grey = (0.5, 0.5, 0.5, 1.0)

    if not crops:
        fig, ax = plt.subplots(figsize=(size, size))
        ax.set_ylabel("Number of GFP+ cells")
        ax.set_title("GFP+ cells per crop")
        ax.set_xlabel("t")
        _style_ax(ax)
        plt.tight_layout()
        plt.savefig(count_path, dpi=150, bbox_inches="tight")
        plt.close()
        fig, ax = plt.subplots(figsize=(size, size))
        ax.set_ylabel("Median (total − area×background)")
        ax.set_title(f"Median fluorescence per crop, GFP+ (threshold={gfp_threshold})")
        ax.set_xlabel("t")
        _style_ax(ax)
        plt.tight_layout()
        plt.savefig(fluo_path, dpi=150, bbox_inches="tight")
        plt.close()
        return

    median_per_t = gfp.groupby(["crop", "t"])["fluo_above_bg"].median().reset_index()
    median_per_t.columns = ["crop", "t", "median_above_bg"]

    # GFP count: per-crop traces in grey, median across crops in red
    fig, ax = plt.subplots(figsize=(size, size))
    count_rows = []
    for crop in crops:
        crop_gfp = gfp[gfp["crop"] == crop]
        per_t_count = crop_gfp.groupby("t")["cell"].count().reset_index()
        per_t_count.columns = ["t", "n_gfp"]
        ax.plot(per_t_count["t"], per_t_count["n_gfp"], color=grey, linestyle="-")
        for _, row in per_t_count.iterrows():
            count_rows.append({"t": row["t"], "crop": crop, "n_gfp": row["n_gfp"]})
    count_df = pd.DataFrame(count_rows)
    if not count_df.empty:
        median_count = count_df.groupby("t")["n_gfp"].median().reset_index()
        median_count.columns = ["t", "n_gfp"]
        ax.plot(median_count["t"], median_count["n_gfp"], color="red", linestyle="-", linewidth=2)
    ax.set_ylabel("Number of GFP+ cells")
    ax.set_title("GFP+ cells per crop")
    ax.set_xlabel("t")
    _style_ax(ax)
    plt.tight_layout()
    plt.savefig(count_path, dpi=150, bbox_inches="tight")
    plt.close()

    # Median fluorescence: per-crop traces in grey, median across crops in red
    fig, ax = plt.subplots(figsize=(size, size))
    for crop in crops:
        crop_med = median_per_t[median_per_t["crop"] == crop]
        ax.plot(crop_med["t"], crop_med["median_above_bg"], color=grey, linestyle="-")
    median_fluo = median_per_t.groupby("t")["median_above_bg"].median().reset_index()
    median_fluo.columns = ["t", "median_above_bg"]
    ax.plot(median_fluo["t"], median_fluo["median_above_bg"], color="red", linestyle="-", linewidth=2)
    ax.set_xlabel("t")
    ax.set_ylabel("Median (total − area×background)")
    ax.set_title(f"Median fluorescence per crop, GFP+ (threshold={gfp_threshold})")
    _style_ax(ax)
    plt.tight_layout()
    plt.savefig(fluo_path, dpi=150, bbox_inches="tight")
    plt.close()

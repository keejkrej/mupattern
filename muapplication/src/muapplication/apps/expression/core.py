"""muexpression core – shared logic for analyze and plot. Used by CLI and GUI."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import zarr

from ...common.progress import ProgressCallback


def run_analyze(
    zarr_path: Path,
    pos: int,
    channel: int,
    output: Path,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Sum pixel intensities per crop per timepoint and write a CSV."""
    store = zarr.DirectoryStore(str(zarr_path))
    root = zarr.open_group(store, mode="r")
    crop_grp = root[f"pos/{pos:03d}/crop"]
    crop_ids = sorted(crop_grp.keys())

    bg_arr = root[f"pos/{pos:03d}/background"]

    rows: list[tuple[int, str, int, int, float]] = []
    total = len(crop_ids)
    for i, crop_id in enumerate(crop_ids):
        arr = crop_grp[crop_id]
        n_times = arr.shape[0]
        area = arr.shape[3] * arr.shape[4]  # h * w

        for t in range(n_times):
            intensity = int(np.array(arr[t, channel, 0]).sum())
            background = float(bg_arr[t, channel, 0])  # per-pixel
            rows.append((t, crop_id, intensity, area, background))

        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Processing crop {i + 1}/{total}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,intensity,area,background\n")
        for t, crop, intensity, area, background in rows:
            fh.write(f"{t},{crop},{intensity},{area},{background}\n")

    if on_progress:
        on_progress(1.0, f"Wrote {len(rows)} rows to {output}")


def run_plot(input_csv: Path, output_dir: Path) -> None:
    """Plot raw intensity, background-corrected total fluor, and max-normalized corrected per crop over time. Writes three square plots into output_dir: intensity.png, background_corrected_total_fluor.png, normalized_corrected.png (same style as tissue plot)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import MaxNLocator

    def _style_ax(ax: plt.Axes) -> None:
        ax.xaxis.set_major_locator(MaxNLocator(nbins=4))
        ax.yaxis.set_major_locator(MaxNLocator(nbins=4))
        ax.tick_params(axis="both", labelsize=12)
        ax.set_xlabel(ax.get_xlabel(), fontsize=14)
        ax.set_ylabel(ax.get_ylabel(), fontsize=14)
        ax.set_title(ax.get_title(), fontsize=16)

    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_path = output_dir / "intensity.png"
    sub_path = output_dir / "background_corrected_total_fluor.png"
    norm_path = output_dir / "normalized_corrected.png"

    df = pd.read_csv(input_csv, dtype={"crop": str})
    df["intensity_above_bg"] = df["intensity"] - df["area"] * df["background"]
    crops = sorted(df["crop"].unique())
    size = 6

    if not crops:
        fig, ax = plt.subplots(figsize=(size, size))
        ax.set_ylabel("Intensity")
        ax.set_title("Raw intensity per crop")
        ax.set_xlabel("t")
        _style_ax(ax)
        plt.tight_layout()
        plt.savefig(raw_path, dpi=150, bbox_inches="tight")
        plt.close()
        fig, ax = plt.subplots(figsize=(size, size))
        ax.set_ylabel("Background-corrected total fluor")
        ax.set_title("Background-corrected total fluor per crop")
        ax.set_xlabel("t")
        _style_ax(ax)
        plt.tight_layout()
        plt.savefig(sub_path, dpi=150, bbox_inches="tight")
        plt.close()
        fig, ax = plt.subplots(figsize=(size, size))
        ax.set_ylabel("Normalized (max=1)")
        ax.set_title("Normalized corrected total fluor per crop")
        ax.set_xlabel("t")
        _style_ax(ax)
        plt.tight_layout()
        plt.savefig(norm_path, dpi=150, bbox_inches="tight")
        plt.close()
        return

    cmap = plt.get_cmap("tab10" if len(crops) <= 10 else "tab20")
    colors = [cmap(i % cmap.N) for i in range(len(crops))]

    fig, ax = plt.subplots(figsize=(size, size))
    for i, crop in enumerate(crops):
        group = df[df["crop"] == crop].sort_values("t")
        ax.plot(group["t"], group["intensity"], color=colors[i], linestyle="-")
    ax.set_ylabel("Intensity")
    ax.set_title("Raw intensity per crop")
    ax.set_xlabel("t")
    _style_ax(ax)
    plt.tight_layout()
    plt.savefig(raw_path, dpi=150, bbox_inches="tight")
    plt.close()

    fig, ax = plt.subplots(figsize=(size, size))
    for i, crop in enumerate(crops):
        group = df[df["crop"] == crop].sort_values("t")
        ax.plot(group["t"], group["intensity_above_bg"], color=colors[i], linestyle="-")
    ax.set_ylabel("Background-corrected total fluor")
    ax.set_title("Background-corrected total fluor per crop")
    ax.set_xlabel("t")
    _style_ax(ax)
    plt.tight_layout()
    plt.savefig(sub_path, dpi=150, bbox_inches="tight")
    plt.close()

    fig, ax = plt.subplots(figsize=(size, size))
    for i, crop in enumerate(crops):
        group = df[df["crop"] == crop].sort_values("t")
        y = group["intensity_above_bg"].values
        m = y.max()
        normalized = y / m if m > 0 else y
        ax.plot(group["t"], normalized, color=colors[i], linestyle="-")
    ax.set_ylabel("Normalized (max=1)")
    ax.set_title("Normalized corrected total fluor per crop")
    ax.set_xlabel("t")
    _style_ax(ax)
    plt.tight_layout()
    plt.savefig(norm_path, dpi=150, bbox_inches="tight")
    plt.close()

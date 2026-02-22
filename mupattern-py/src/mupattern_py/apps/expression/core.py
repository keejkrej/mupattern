"""Expression core – shared logic for analyze and plot."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from ...common.io_zarr import open_zarr_group
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
    root = open_zarr_group(zarr_path, mode="r")
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


def run_plot(input_csv: Path, output: Path) -> None:
    """Plot background-corrected total fluor per crop over time, with median. Matches desktop ExpressionTab."""
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

    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(input_csv, dtype={"crop": str})
    df["intensity_above_bg"] = df["intensity"] - df["area"] * df["background"]
    crops = sorted(df["crop"].unique())
    size = 6

    # Gray at 30% for bulk traces (like ExpressionTab BULK_LINE_STROKE)
    bulk_color = (0.5, 0.5, 0.5, 0.3)

    fig, ax = plt.subplots(figsize=(size, size))
    for crop in crops:
        group = df[df["crop"] == crop].sort_values("t")
        ax.plot(group["t"], group["intensity_above_bg"], color=bulk_color, linestyle="-", linewidth=1)

    # Median per t (like ExpressionTab dataWithMedian)
    by_t: dict[int, list[float]] = {}
    for _, row in df.iterrows():
        v = row["intensity_above_bg"]
        if isinstance(v, (int, float)) and not (isinstance(v, float) and v != v):
            by_t.setdefault(int(row["t"]), []).append(float(v))
    t_sorted = sorted(by_t.keys())
    median_vals = []
    for t in t_sorted:
        vals = by_t[t]
        if vals:
            sorted_v = sorted(vals)
            m = len(sorted_v) // 2
            med = sorted_v[m] if len(sorted_v) % 2 else (sorted_v[m - 1] + sorted_v[m]) / 2
            median_vals.append(med)
        else:
            median_vals.append(float("nan"))
    ax.plot(t_sorted, median_vals, color="red", linestyle="-", linewidth=2, label="median")

    ax.set_ylabel("fluorescence")
    ax.set_title("Background-corrected total fluorescence")
    ax.set_xlabel("t")
    ax.legend(loc="upper left")
    _style_ax(ax)
    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight")
    plt.close()

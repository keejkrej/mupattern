"""muexpression core – shared logic for analyze and plot. Used by CLI and GUI."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
import zarr

ProgressCallback = Callable[[float, str], None]


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

    rows: list[tuple[int, str, int, float]] = []
    total = len(crop_ids)
    for i, crop_id in enumerate(crop_ids):
        arr = crop_grp[crop_id]
        n_times = arr.shape[0]

        for t in range(n_times):
            intensity = int(np.array(arr[t, channel, 0]).sum())
            background = float(bg_arr[t, channel, 0])
            rows.append((t, crop_id, intensity, background))

        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Processing crop {i + 1}/{total}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,intensity,background\n")
        for t, crop, intensity, background in rows:
            fh.write(f"{t},{crop},{intensity},{background}\n")

    if on_progress:
        on_progress(1.0, f"Wrote {len(rows)} rows to {output}")


def run_plot(input_csv: Path, output: Path) -> None:
    """Plot intensity over time for every crop (raw and background-subtracted)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    df = pd.read_csv(input_csv, dtype={"crop": str})
    n_crops = df["crop"].nunique()
    max_t = df["t"].max()

    fig, (ax_raw, ax_sub) = plt.subplots(
        1, 2, figsize=(12, 4), sharey=False, gridspec_kw={"wspace": 0.3}
    )

    for _crop_id, group in df.groupby("crop"):
        group = group.sort_values("t")
        ax_raw.plot(group["t"], group["intensity"], linewidth=0.5, alpha=0.4)
        ax_sub.plot(
            group["t"],
            group["intensity"] - group["background"],
            linewidth=0.5,
            alpha=0.4,
        )

    ax_raw.set_xlabel("t")
    ax_raw.set_ylabel("intensity")
    ax_raw.set_title("Raw intensity")
    ax_raw.set_xlim(0, max_t)

    ax_sub.set_xlabel("t")
    ax_sub.set_ylabel("intensity − background")
    ax_sub.set_title("Background-subtracted")
    ax_sub.set_xlim(0, max_t)

    output.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output, dpi=150, bbox_inches="tight")
    plt.close()

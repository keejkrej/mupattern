"""muspot core – shared logic for detect and plot. Used by CLI and GUI."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
import zarr

ProgressCallback = Callable[[float, str], None]


def parse_slice_string(s: str, length: int) -> list[int]:
    """Parse a human-friendly slice string into a sorted list of unique indices. Raises ValueError on invalid input."""
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


def run_detect(
    zarr_path: Path,
    pos: int,
    channel: int,
    output: Path,
    crop_slice: str = "all",
    model: str = "general",
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Detect spots per crop per timepoint and write a CSV."""
    from spotiflow.model import Spotiflow

    sf_model = Spotiflow.from_pretrained(model)

    store = zarr.DirectoryStore(str(zarr_path))
    root = zarr.open_group(store, mode="r")
    crop_grp = root[f"pos/{pos:03d}/crop"]
    all_crop_ids = sorted(crop_grp.keys())
    crop_indices = parse_slice_string(crop_slice, len(all_crop_ids))
    crop_ids = [all_crop_ids[i] for i in crop_indices]

    rows: list[tuple[int, str, int, float, float]] = []
    total = len(crop_ids)
    for i, crop_id in enumerate(crop_ids):
        arr = crop_grp[crop_id]
        n_times = arr.shape[0]

        for t in range(n_times):
            frame = np.array(arr[t, channel, 0])
            spots, _details = sf_model.predict(frame)

            for spot_idx, (y, x) in enumerate(spots):
                rows.append((t, crop_id, spot_idx, float(y), float(x)))

        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Processing crop {i + 1}/{total}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,spot,y,x\n")
        for t, crop, spot, y, x in rows:
            fh.write(f"{t},{crop},{spot},{y:.2f},{x:.2f}\n")

    if on_progress:
        on_progress(1.0, f"Wrote {len(rows)} rows to {output}")


def run_plot(input_csv: Path, output: Path) -> None:
    """Plot spot count over time for every crop."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    df = pd.read_csv(input_csv, dtype={"crop": str})
    counts = df.groupby(["t", "crop"]).size().reset_index(name="count")
    n_crops = counts["crop"].nunique()
    max_t = counts["t"].max()

    fig, ax = plt.subplots(figsize=(6, 4))

    for _crop_id, group in counts.groupby("crop"):
        group = group.sort_values("t")
        ax.plot(group["t"], group["count"], linewidth=0.5, alpha=0.4)

    ax.set_xlabel("t")
    ax.set_ylabel("spot count")
    ax.set_title("Spots per crop over time")
    ax.set_xlim(0, max_t)

    output.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output, dpi=150, bbox_inches="tight")
    plt.close()

"""Convert core – ND2 to TIFF."""

from __future__ import annotations

import csv
from pathlib import Path

import tifffile

from ...common.nd2_utils import read_frame_2d
from ...common.slices import parse_slice_string
from ...common.progress import ProgressCallback


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
        pos_dir = output / f"Pos{p_idx}"
        pos_dir.mkdir(exist_ok=True)

        with open(pos_dir / "time_map.csv", "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["t", "t_real"])
            for t_new, t_orig in enumerate(time_indices):
                writer.writerow([t_new, t_orig])

        for t_new, t_orig in enumerate(time_indices):
            for c in range(n_chan):
                for z in range(n_z):
                    frame = read_frame_2d(f, p_idx, t_orig, c, z)

                    fname = (
                        f"img_channel{c:03d}"
                        f"_position{p_idx:03d}"
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

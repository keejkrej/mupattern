"""ND2 file helpers."""

from __future__ import annotations

import numpy as np


def read_frame_2d(f, p: int, t: int, c: int, z: int) -> np.ndarray:
    """Read 2D Y×X frame at (p, t, c, z). Returns one channel (first if multi-component)."""
    sizes = f.sizes
    dim_order = [d for d in sizes.keys() if d not in ("Y", "X")]
    coord_shape = tuple(sizes[d] for d in dim_order)
    idx = tuple({"P": p, "T": t, "C": c, "Z": z}.get(d, 0) for d in dim_order)
    seq_index = int(np.ravel_multi_index(idx, coord_shape))
    frame = f.read_frame(seq_index)
    if frame.ndim == 3:
        return frame[0]  # first channel if C×Y×X
    return np.asarray(frame)

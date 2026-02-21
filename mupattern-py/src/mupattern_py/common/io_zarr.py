from __future__ import annotations

from pathlib import Path

import zarr


def open_zarr_group(path: Path | str, mode: str = "r") -> zarr.Group:
    """Open Zarr group. Only accepts Zarr v3 format."""
    return zarr.open_group(str(path), mode=mode, zarr_format=3)

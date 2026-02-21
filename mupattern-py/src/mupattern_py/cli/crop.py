"""mupattern crop – crop TIFFs to zarr."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..common.progress import progress_json_stderr
from ..apps.crop.core import _read_bbox_csv, run_crop


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
        typer.Option("--background/--no-background", help="Compute per-frame background (median outside crops)."),
    ] = False,
) -> None:
    """Crop pattern positions from microscopy TIFFs into a zarr store."""
    _read_bbox_csv(bbox)
    try:
        run_crop(input_dir, pos, bbox, output, background, on_progress=progress_json_stderr)
    except (FileNotFoundError, ValueError) as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e

"""mupattern spot – detect fluorescent spots in micropattern crops using spotiflow."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..apps.spot.core import run_detect


def _progress_echo(progress: float, message: str) -> None:
    typer.echo(message)


def spot(
    zarr_path: Annotated[
        Path,
        typer.Option("--zarr", help="Path to zarr store."),
    ],
    pos: Annotated[
        int,
        typer.Option(help="Position number."),
    ],
    channel: Annotated[
        int,
        typer.Option(help="Channel number."),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output CSV file path."),
    ],
    crop: Annotated[
        str,
        typer.Option(
            help='Crops to process: "all" or comma-separated indices/slices, e.g. "0:10:2, 15".',
        ),
    ],
    model: Annotated[
        str,
        typer.Option(help="Spotiflow pretrained model name."),
    ],
) -> None:
    """Detect spots per crop per timepoint and write a CSV."""
    try:
        typer.echo(f"Loading spotiflow model '{model}'...")
        typer.echo(f"Processing pos {pos:03d}, channel {channel} from {zarr_path}")
        run_detect(
            zarr_path,
            pos,
            channel,
            output,
            crop_slice=crop,
            model=model,
            on_progress=_progress_echo,
        )
        typer.echo(f"Wrote {output}")
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e

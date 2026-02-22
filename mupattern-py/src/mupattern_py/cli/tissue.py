"""mupattern tissue – segment then analyze: masks.zarr + tissue CSV."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..apps.tissue.core import run_pipeline


def _progress_echo(progress: float, message: str) -> None:
    typer.echo(message)


def tissue(
    input: Annotated[
        Path,
        typer.Option("--input", help="Path to zarr store (e.g. crops.zarr)."),
    ],
    pos: Annotated[
        int,
        typer.Option("--pos", help="Position index."),
    ],
    channel_fluorescence: Annotated[
        int,
        typer.Option("--channel-fluorescence", help="Channel index for fluorescence (e.g. GFP)."),
    ],
    output: Annotated[
        Path,
        typer.Option("--output", help="Output CSV path (t,crop,cell,total_fluorescence,cell_area,background)."),
    ],
    method: Annotated[
        str,
        typer.Option("--method", help="Segment method: 'cellpose' | 'cellsam'."),
    ] = "cellpose",
    channel_phase: Annotated[
        int | None,
        typer.Option("--channel-phase", help="Channel index for phase contrast (required when method=cellpose or method=cellsam)."),
    ] = None,
    masks: Annotated[
        Path | None,
        typer.Option("--masks", help="Output masks path (default: output dir / masks.zarr)."),
    ] = None,
) -> None:
    """Run segment then analyze: write masks.zarr, then tissue CSV."""
    try:
        run_pipeline(
            input,
            pos,
            channel_fluorescence,
            output,
            method=method,
            channel_phase=channel_phase,
            masks_path=masks,
            on_progress=_progress_echo,
        )
        typer.echo(f"Wrote masks and {output}")
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e

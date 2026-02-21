"""mupattern movie – create movie from zarr crop."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

import typer

from ..common.progress import progress_json_stderr
from ..apps.crop.core import run_movie


def movie(
    input_zarr: Annotated[
        Path,
        typer.Option(
            "--input-zarr",
            exists=True,
            file_okay=False,
            help="Path to zarr store.",
        ),
    ],
    pos: Annotated[int, typer.Option(help="Position number.")],
    crop: Annotated[int, typer.Option(help="Crop number.")],
    channel: Annotated[int, typer.Option(help="Channel number.")],
    time: Annotated[
        str,
        typer.Option(
            help='Timepoints: "all" or comma-separated indices/slices, e.g. "1:10:2, 3, 6".',
        ),
    ],
    output: Annotated[Path, typer.Option(help="Output movie file path (e.g. movie.mp4).")],
    fps: Annotated[int, typer.Option(help="Frames per second.")] = 10,
    colormap: Annotated[
        Literal["grayscale", "hot", "viridis"],
        typer.Option(help='Colormap: "grayscale", "hot", or "viridis".'),
    ] = "grayscale",
    spots: Annotated[
        Path | None,
        typer.Option("--spots", exists=True, dir_okay=False, help="Optional spots CSV (t,crop,spot,y,x) to overlay."),
    ] = None,
) -> None:
    """Create a movie from a zarr crop."""
    try:
        run_movie(
            input_zarr, pos, crop, channel, time, output, fps, colormap, spots,
            on_progress=progress_json_stderr,
        )
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e

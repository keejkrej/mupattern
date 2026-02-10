"""muspot – detect fluorescent spots in micropattern crops using spotiflow.

Commands:
    muspot detect --zarr crops.zarr --pos 9 --channel 2 --output spots.csv
    muspot detect --zarr crops.zarr --pos 9 --channel 2 --crop "0:10" --output spots.csv
    muspot plot --input spots.csv --output spots.png
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from .core import run_detect, run_plot

app = typer.Typer(
    add_completion=False,
    help="Detect fluorescent spots in micropattern crops using spotiflow.",
)


def _progress_echo(progress: float, message: str) -> None:
    typer.echo(message)


@app.command()
def detect(
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
    ] = "all",
    model: Annotated[
        str,
        typer.Option(help="Spotiflow pretrained model name."),
    ] = "general",
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


@app.command()
def plot(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            dir_okay=False,
            help="CSV from 'muspot detect' (t,crop,spot,y,x).",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output plot image path (e.g. spots.png)."),
    ],
) -> None:
    """Plot spot count over time for every crop."""
    typer.echo(f"Loaded {input}")
    run_plot(input, output)
    typer.echo(f"Saved plot to {output}")

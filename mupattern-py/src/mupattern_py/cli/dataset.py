"""mupattern dataset – create training datasets (kill)."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..apps.kill.core import _load_annotations, run_dataset


def _progress_echo(progress: float, message: str) -> None:
    typer.echo(message)


app = typer.Typer(add_completion=False, help="Create training datasets.")


@app.command("kill")
def kill(
    zarr_path: Annotated[
        Path,
        typer.Option("--zarr", help="Path to zarr store."),
    ],
    pos: Annotated[
        int,
        typer.Option(help="Position number."),
    ],
    annotations: Annotated[
        Path,
        typer.Option(
            "--annotations",
            exists=True,
            dir_okay=False,
            help="Path to annotations CSV file.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output directory for the HuggingFace Dataset."),
    ],
) -> None:
    """Create a HuggingFace Dataset from crops.zarr + annotations CSV for kill-curve training."""
    try:
        typer.echo(f"Loading pos {pos} from {zarr_path}")
        ann_dict = _load_annotations(annotations)
        typer.echo(f"  {len(ann_dict)} annotations from {annotations}")
        run_dataset(zarr_path, pos, annotations, output, on_progress=_progress_echo)
        typer.echo(f"Saved dataset to {output}")
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e

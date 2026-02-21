"""mupattern expression – measure fluorescence expression in micropattern crops."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..common.progress import progress_json_stderr
from ..apps.expression.core import run_analyze


def expression(
    pos: Annotated[int, typer.Option(help="Position number.")],
    channel: Annotated[int, typer.Option(help="Channel number.")],
    output: Annotated[Path, typer.Option(help="Output CSV file path.")],
    workspace: Annotated[
        Path | None,
        typer.Option("--workspace", help="Workspace directory containing crops.zarr."),
    ] = None,
    zarr: Annotated[
        Path | None,
        typer.Option("--zarr", help="Path to zarr store (when --workspace not given)."),
    ] = None,
) -> None:
    """Sum pixel intensities per crop per timepoint and write a CSV."""
    zarr_path: Path
    if workspace is not None:
        zarr_path = workspace / "crops.zarr"
    elif zarr is not None:
        zarr_path = zarr
    else:
        raise typer.BadParameter("Provide --workspace or --zarr")
    run_analyze(zarr_path, pos, channel, output, on_progress=progress_json_stderr)

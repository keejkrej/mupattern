"""mupattern expression – measure fluorescence expression in micropattern crops."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..common.progress import progress_json_stderr
from ..apps.expression.core import run_analyze


def expression(
    input: Annotated[
        Path,
        typer.Option("--input", help="Path to zarr store (e.g. crops.zarr)."),
    ],
    pos: Annotated[int, typer.Option(help="Position number.")],
    channel: Annotated[int, typer.Option(help="Channel number.")],
    output: Annotated[Path, typer.Option(help="Output CSV file path.")],
) -> None:
    """Sum pixel intensities per crop per timepoint and write a CSV."""
    run_analyze(input, pos, channel, output, on_progress=progress_json_stderr)

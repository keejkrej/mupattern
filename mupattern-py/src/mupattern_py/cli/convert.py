"""mupattern convert – ND2 to TIFF."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..common.progress import progress_json_stderr
from ..common.slices import parse_slice_string
from ..apps.convert.core import run_convert

app = typer.Typer(
    add_completion=False,
    invoke_without_command=True,
    help="Convert ND2 file into per-position TIFF folders.",
)


@app.callback()
def convert(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            dir_okay=False,
            help="Path to the .nd2 file to convert.",
        ),
    ],
    pos: Annotated[
        str,
        typer.Option(
            help='Positions to convert: "all" or comma-separated indices/slices, e.g. "0:5, 10".',
        ),
    ],
    time: Annotated[
        str,
        typer.Option(
            help='Timepoints to convert: "all" or comma-separated indices/slices, e.g. "0:50, 100".',
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output directory (will contain Pos*/... TIFF folders)."),
    ],
) -> None:
    """Convert an ND2 file into per-position TIFF folders."""
    import nd2

    f = nd2.ND2File(str(input))
    sizes = f.sizes
    n_pos = sizes.get("P", 1)
    n_time = sizes.get("T", 1)
    n_chan = sizes.get("C", 1)
    n_z = sizes.get("Z", 1)
    f.close()

    try:
        pos_indices = parse_slice_string(pos, n_pos)
        time_indices = parse_slice_string(time, n_time)
    except ValueError as e:
        raise typer.BadParameter(str(e)) from e

    total = len(pos_indices) * len(time_indices) * n_chan * n_z

    typer.echo(f"ND2: {n_pos} positions, T={n_time}, C={n_chan}, Z={n_z}")
    typer.echo("")
    typer.echo(
        f"Selected {len(pos_indices)}/{n_pos} positions, "
        f"{len(time_indices)}/{n_time} timepoints, "
        f"{n_chan} channels, {n_z} z-slices"
    )
    typer.echo(f"Total frames to write: {total}")
    typer.echo("")
    typer.echo("Positions:")
    typer.echo(f"  {', '.join(f'Pos{i}' for i in pos_indices)}")
    typer.echo("")
    typer.echo("Timepoints (original indices):")
    typer.echo(f"  {time_indices}")
    typer.echo("")

    if not typer.confirm("Proceed with conversion?"):
        raise typer.Abort()

    try:
        run_convert(input, pos, time, output, on_progress=progress_json_stderr)
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e

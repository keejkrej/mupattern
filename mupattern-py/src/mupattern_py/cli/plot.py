"""mupattern plot – plot kill outputs."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..apps.kill.core import _find_violations, _load_csv as _load_kill_csv, run_plot as run_kill_plot

app = typer.Typer(
    add_completion=False,
    rich_markup_mode=None,
    help="Plot kill outputs.",
)


@app.command("kill")
def kill(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            dir_okay=False,
            help="Predictions CSV (t,crop,label).",
        ),
    ],
    output: Annotated[Path, typer.Option(help="Output plot image path (e.g. plot.png).")],
    bin_width: Annotated[
        int,
        typer.Option("--bin-width", help="Histogram bin width in frames."),
    ] = 5,
) -> None:
    """Plot kill curve (n alive) and death time distribution."""
    df = _load_kill_csv(input)
    typer.echo(f"Loaded {len(df)} predictions, {df['crop'].nunique()} crops, t=0..{df['t'].max()}")
    run_kill_plot(input, output, bin_width=bin_width)
    typer.echo(f"Saved plot to {output}")
    violations = _find_violations(df)
    if len(violations) > 0:
        typer.echo(f"Violations: {len(violations)} rows across {violations['crop'].nunique()} crops")

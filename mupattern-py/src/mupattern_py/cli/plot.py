"""mupattern plot – plot outputs from analyze commands (expression, kill, spot, tissue)."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..apps.expression.core import run_plot as run_expression_plot
from ..apps.kill.core import _find_violations, _load_csv as _load_kill_csv, run_plot as run_kill_plot
from ..apps.spot.core import run_plot as run_spot_plot
from ..apps.tissue.core import run_plot as run_tissue_plot

app = typer.Typer(
    add_completion=False,
    help="Plot outputs from analyze commands (expression, kill, spot, tissue).",
)


@app.command("expression")
def expression(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            dir_okay=False,
            help="CSV from expression (t,crop,intensity,area,background).",
        ),
    ],
    output: Annotated[Path, typer.Option(help="Output plot image path (e.g. Pos0_expression.png).")],
) -> None:
    """Plot background-corrected total fluor per crop (matches desktop ExpressionTab)."""
    run_expression_plot(input, output)
    typer.echo(f"Saved plot to {output}")


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
        typer.Option("--bin-width", help="Histogram bin width in frames (default 5)."),
    ] = 5,
) -> None:
    """Plot kill curve (n alive) and death time distribution. Uses same clean logic as desktop KillTab."""
    df = _load_kill_csv(input)
    typer.echo(f"Loaded {len(df)} predictions, {df['crop'].nunique()} crops, t=0..{df['t'].max()}")
    run_kill_plot(input, output, bin_width=bin_width)
    typer.echo(f"Saved plot to {output}")
    violations = _find_violations(df)
    if len(violations) > 0:
        typer.echo(f"Violations: {len(violations)} rows across {violations['crop'].nunique()} crops")


@app.command("spot")
def spot(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            dir_okay=False,
            help="CSV from spot detect (t,crop,spot,y,x).",
        ),
    ],
    output: Annotated[Path, typer.Option(help="Output plot image path (e.g. spots.png).")],
) -> None:
    """Plot spot count over time for every crop."""
    run_spot_plot(input, output)
    typer.echo(f"Saved plot to {output}")


@app.command("tissue")
def tissue(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            dir_okay=False,
            help="CSV from tissue analyze (t,crop,cell,total_fluorescence,cell_area,background).",
        ),
    ],
    output: Annotated[Path, typer.Option(help="Output directory for plots (gfp_count.png, median_fluorescence.png).")],
    gfp_threshold: Annotated[
        float,
        typer.Option("--gfp-threshold", help="GFP+ when (total_fluorescence/cell_area) - background > this."),
    ],
) -> None:
    """Plot GFP+ count and median fluorescence per crop over time."""
    run_tissue_plot(input, output, gfp_threshold)
    typer.echo(f"Saved plots to {output / 'gfp_count.png'} and {output / 'median_fluorescence.png'}")

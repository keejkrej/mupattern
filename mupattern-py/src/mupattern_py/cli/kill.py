"""mupattern kill – run inference (predict) on crops, then clean (monotonicity)."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..apps.kill.core import _find_violations, _load_csv, run_clean, run_predict


def _progress_echo(progress: float, message: str) -> None:
    typer.echo(message)


def kill(
    input: Annotated[
        Path,
        typer.Option("--input", help="Path to zarr store (e.g. crops.zarr)."),
    ],
    pos: Annotated[
        int,
        typer.Option(help="Position number."),
    ],
    model: Annotated[
        str,
        typer.Option(
            help="Local path or HuggingFace repo ID (e.g. keejkrej/mupattern-resnet18).",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output CSV file path."),
    ],
    batch_size: Annotated[
        int,
        typer.Option("--batch-size", help="Inference batch size."),
    ] = 256,
    t_start: Annotated[
        int | None,
        typer.Option("--t-start", help="Start timepoint (inclusive)."),
    ] = None,
    t_end: Annotated[
        int | None,
        typer.Option("--t-end", help="End timepoint (exclusive)."),
    ] = None,
    crop_start: Annotated[
        int | None,
        typer.Option("--crop-start", help="Start crop index (inclusive)."),
    ] = None,
    crop_end: Annotated[
        int | None,
        typer.Option("--crop-end", help="End crop index (exclusive)."),
    ] = None,
) -> None:
    """Run inference on crops.zarr positions and write predictions CSV."""
    try:
        t_range = None
        if t_start is not None and t_end is not None:
            t_range = (t_start, t_end)
        elif t_start is not None or t_end is not None:
            typer.echo("Error: both --t-start and --t-end must be provided if using time range.", err=True)
            raise typer.Exit(1)

        crop_range = None
        if crop_start is not None and crop_end is not None:
            crop_range = (crop_start, crop_end)
        elif crop_start is not None or crop_end is not None:
            typer.echo("Error: both --crop-start and --crop-end must be provided if using crop range.", err=True)
            raise typer.Exit(1)

        n_crops_desc = f"crops {crop_range[0]}-{crop_range[1]}" if crop_range else "all crops"
        n_t_desc = f"t={t_range[0]}-{t_range[1]}" if t_range else "all t"
        typer.echo(f"Predicting pos {pos} ({n_crops_desc}, {n_t_desc})")

        run_predict(
            input,
            pos,
            model,
            output,
            batch_size=batch_size,
            t_start=t_start,
            t_end=t_end,
            crop_start=crop_start,
            crop_end=crop_end,
            on_progress=_progress_echo,
        )

        typer.echo(f"Wrote predictions to {output}")

        df = _load_csv(output)
        violations = _find_violations(df)
        n_violations = len(violations)
        noisy_crops = violations["crop"].unique() if n_violations > 0 else []

        if n_violations == 0:
            typer.echo("No monotonicity violations, output is clean.")
        else:
            typer.echo(f"Found {n_violations} violations across {len(noisy_crops)} crops:")
            for crop_id in sorted(noisy_crops):
                crop_violations = violations[violations["crop"] == crop_id]
                ts = sorted(crop_violations["t"].tolist())
                typer.echo(f"  crop {crop_id}: resurrects at t={ts}")
            typer.echo(f"Corrected {len(violations)} rows (forced to absent)")
            run_clean(output, output)
            typer.echo(f"Wrote cleaned output to {output}")
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e

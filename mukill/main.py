"""mukill – train classifiers and analyze kill curves for micropattern experiments.

Commands:
    mukill dataset --zarr crops.zarr --pos 0 --annotations annotations.csv --output ./dataset
    mukill train --dataset ./dataset --output ./model
    mukill predict --zarr crops.zarr --pos 0 --model ./model --output predictions.csv
    mukill plot --input predictions.csv --output plot.png
    mukill clean --input predictions.csv --output cleaned.csv
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from core import run_clean, run_dataset, run_plot, run_predict, run_train

app = typer.Typer(
    add_completion=False,
    help="Train classifiers and analyze kill curves for micropattern experiments.",
)


def _progress_echo(progress: float, message: str) -> None:
    typer.echo(message)


@app.command()
def dataset(
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
    """Create a HuggingFace Dataset from crops.zarr + annotations CSV."""
    try:
        from core import _load_annotations

        typer.echo(f"Loading pos {pos} from {zarr_path}")
        ann_dict = _load_annotations(annotations)
        typer.echo(f"  {len(ann_dict)} annotations from {annotations}")
        run_dataset(zarr_path, pos, annotations, output, on_progress=_progress_echo)
        typer.echo(f"Saved dataset to {output}")
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e


@app.command()
def train(
    dataset: Annotated[
        Path,
        typer.Option(
            exists=True,
            file_okay=False,
            help="Path to the HuggingFace Dataset created by 'mukill dataset'.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output directory for the trained model."),
    ],
    epochs: Annotated[
        int,
        typer.Option(help="Number of training epochs."),
    ] = 20,
    batch_size: Annotated[
        int,
        typer.Option(help="Training batch size."),
    ] = 32,
    lr: Annotated[
        float,
        typer.Option(help="Learning rate."),
    ] = 1e-4,
    split: Annotated[
        float,
        typer.Option(help="Fraction of data to use for validation."),
    ] = 0.2,
) -> None:
    """Train a ResNet-18 binary classifier."""
    run_train(dataset, output, epochs, batch_size, lr, split, on_progress=_progress_echo)
    typer.echo(f"Model saved to {output / 'best'}")


@app.command()
def predict(
    zarr_path: Annotated[
        Path,
        typer.Option("--zarr", help="Path to zarr store."),
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
        typer.Option(help="Inference batch size."),
    ] = 64,
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
            raise typer.Exit(code=1)

        crop_range = None
        if crop_start is not None and crop_end is not None:
            crop_range = (crop_start, crop_end)
        elif crop_start is not None or crop_end is not None:
            typer.echo("Error: both --crop-start and --crop-end must be provided if using crop range.", err=True)
            raise typer.Exit(code=1)

        n_crops_desc = f"crops {crop_range[0]}-{crop_range[1]}" if crop_range else "all crops"
        n_t_desc = f"t={t_range[0]}-{t_range[1]}" if t_range else "all t"
        typer.echo(f"Predicting pos {pos} ({n_crops_desc}, {n_t_desc})")

        run_predict(
            zarr_path,
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
            help="Predictions CSV (t,crop,label).",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output plot image path (e.g. plot.png)."),
    ],
) -> None:
    """Plot kill curve: number of present cells over time."""
    from core import _find_violations, _load_csv

    df = _load_csv(input)
    n_crops = df["crop"].nunique()
    max_t = df["t"].max()
    typer.echo(f"Loaded {len(df)} predictions, {n_crops} crops, t=0..{max_t}")

    run_plot(input, output)
    typer.echo(f"Saved plot to {output}")

    violations = _find_violations(df)
    n_noisy = violations["crop"].nunique() if len(violations) > 0 else 0
    typer.echo(f"Violations: {len(violations)} rows across {n_noisy} crops")


@app.command()
def clean(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            dir_okay=False,
            help="Predictions CSV (t,crop,label).",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output cleaned CSV path."),
    ],
) -> None:
    """Clean predictions by enforcing monotonicity (once absent, stays absent)."""
    from core import _find_violations, _load_csv

    df = _load_csv(input)
    typer.echo(f"Loaded {len(df)} predictions")

    violations = _find_violations(df)
    n_violations = len(violations)
    noisy_crops = violations["crop"].unique() if n_violations > 0 else []

    if n_violations == 0:
        typer.echo("No violations found, already clean.")
    else:
        typer.echo(f"Found {n_violations} violations across {len(noisy_crops)} crops:")
        for crop_id in sorted(noisy_crops):
            crop_violations = violations[violations["crop"] == crop_id]
            ts = sorted(crop_violations["t"].tolist())
            typer.echo(f"  crop {crop_id}: resurrects at t={ts}")
        typer.echo(f"Corrected {len(violations)} rows (forced to absent)")

    run_clean(input, output)
    typer.echo(f"Wrote to {output}")

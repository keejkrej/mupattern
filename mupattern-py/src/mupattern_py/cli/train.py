"""mupattern train – train models (kill), export ONNX."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from ..apps.kill.core import run_export_onnx, run_train


def _progress_echo(progress: float, message: str) -> None:
    typer.echo(message)


app = typer.Typer(add_completion=False, help="Train models, export to ONNX.")

kill_app = typer.Typer(
    add_completion=False,
    invoke_without_command=True,
    help="Train kill-curve classifier.",
)


@kill_app.callback()
def train_kill(
    dataset: Annotated[
        Path,
        typer.Option(
            exists=True,
            file_okay=False,
            help="Path to the HuggingFace Dataset from 'mupattern dataset kill'.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output directory for the trained model."),
    ],
    epochs: Annotated[
        int,
        typer.Option(help="Number of training epochs."),
    ],
    batch_size: Annotated[
        int,
        typer.Option(help="Training batch size."),
    ],
    lr: Annotated[
        float,
        typer.Option(help="Learning rate."),
    ],
    split: Annotated[
        float,
        typer.Option(help="Fraction of data to use for validation."),
    ],
) -> None:
    """Train a ResNet-18 binary classifier for kill-curve inference."""
    run_train(dataset, output, epochs, batch_size, lr, split, on_progress=_progress_echo)
    typer.echo(f"Model saved to {output / 'best'}")


@kill_app.command("export-onnx")
def export_onnx(
    model: Annotated[
        str,
        typer.Option(
            help="Local path or HuggingFace repo ID (e.g. keejkrej/mupattern-resnet18).",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output directory for the ONNX model."),
    ],
) -> None:
    """Export a trained model to ONNX format for use in mupattern-desktop."""
    typer.echo(f"Exporting {model} to ONNX...")
    run_export_onnx(model, output)
    typer.echo(f"Saved ONNX model to {output}")


app.add_typer(kill_app, name="kill")

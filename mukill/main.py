"""mukill – train classifiers and analyze kill curves for micropattern experiments.

Commands:
    mukill dataset --config dataset.yaml --output ./dataset
    mukill train --dataset ./dataset --output ./model
    mukill predict --config predict.yaml --model ./model --output predictions.csv
    mukill plot --input predictions.csv --output plot.png
    mukill clean --input predictions.csv --output cleaned.csv
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Annotated

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import typer
import yaml
import zarr
from PIL import Image as PILImage
from rich.progress import track

app = typer.Typer(
    add_completion=False,
    help="Train classifiers and analyze kill curves for micropattern experiments.",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_csv(csv_path: Path) -> pd.DataFrame:
    """Load a predictions/annotations CSV (t,crop,label) into a DataFrame."""
    df = pd.read_csv(csv_path, dtype={"crop": str})
    if df["label"].dtype == object:
        df["label"] = df["label"].map({"true": True, "false": False})
    else:
        df["label"] = df["label"].astype(bool)
    return df


def _find_violations(df: pd.DataFrame) -> pd.DataFrame:
    """Find crops that violate monotonicity (once absent, must stay absent)."""
    violations = []
    for crop_id, group in df.groupby("crop"):
        group = group.sort_values("t")
        seen_false = False
        for _, row in group.iterrows():
            if not row["label"]:
                seen_false = True
            elif seen_false:
                violations.append(row)
    if violations:
        return pd.DataFrame(violations)
    return pd.DataFrame(columns=df.columns)


def _clean_df(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Enforce monotonicity: once a crop goes false, force all later frames false."""
    corrected = []
    rows = []

    for crop_id, group in df.groupby("crop"):
        group = group.sort_values("t").copy()
        seen_false = False

        for idx, row in group.iterrows():
            if not row["label"]:
                seen_false = True
                rows.append(row)
            elif seen_false:
                corrected.append(row.to_dict())
                new_row = row.copy()
                new_row["label"] = False
                rows.append(new_row)
            else:
                rows.append(row)

    cleaned = pd.DataFrame(rows)
    report = pd.DataFrame(corrected) if corrected else pd.DataFrame(columns=df.columns)
    return cleaned, report


# ---------------------------------------------------------------------------
# Dataset command
# ---------------------------------------------------------------------------


def _load_annotations(csv_path: Path) -> dict[str, bool]:
    """Load annotations CSV → {"t:cropId": bool}."""
    annotations: dict[str, bool] = {}
    with open(csv_path, newline="") as fh:
        for row in csv.DictReader(fh):
            key = f"{row['t']}:{row['crop']}"
            annotations[key] = row["label"] == "true"
    return annotations


def _build_examples(
    zarr_path: Path,
    pos: int,
    annotations: dict[str, bool],
) -> list[dict]:
    """Read crops from zarr and pair with annotations."""
    store = zarr.DirectoryStore(str(zarr_path))
    root = zarr.open_group(store, mode="r")

    crop_grp = root[f"pos/{pos:03d}/crop"]
    crop_ids = sorted(crop_grp.keys())

    examples = []
    for crop_id in track(crop_ids, description=f"  Pos {pos}"):
        arr = crop_grp[crop_id]
        n_times = arr.shape[0]

        for t in range(n_times):
            key = f"{t}:{crop_id}"
            if key not in annotations:
                continue

            frame = np.array(arr[t, 0, 0])
            lo, hi = float(frame.min()), float(frame.max())
            if hi > lo:
                normalized = ((frame - lo) / (hi - lo) * 255).astype(np.uint8)
            else:
                normalized = np.zeros_like(frame, dtype=np.uint8)

            img = PILImage.fromarray(normalized, mode="L")
            examples.append(
                {
                    "image": img,
                    "label": int(annotations[key]),
                    "pos": pos,
                    "crop": crop_id,
                    "t": t,
                }
            )

    return examples


@app.command()
def dataset(
    config: Annotated[
        Path,
        typer.Option(
            exists=True,
            dir_okay=False,
            help="YAML config mapping zarr stores + positions to annotation CSVs.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output directory for the HuggingFace Dataset."),
    ],
) -> None:
    """Create a HuggingFace Dataset from crops.zarr + annotations CSV."""
    from datasets import ClassLabel, Dataset, Features, Image, Value

    with open(config) as f:
        cfg = yaml.safe_load(f)

    all_examples: list[dict] = []

    for source in cfg["sources"]:
        zarr_path = Path(source["zarr"])
        pos = int(source["pos"])
        ann_path = Path(source["annotations"])

        typer.echo(f"Loading pos {pos} from {zarr_path}")
        annotations = _load_annotations(ann_path)
        typer.echo(f"  {len(annotations)} annotations from {ann_path}")

        examples = _build_examples(zarr_path, pos, annotations)
        all_examples.extend(examples)
        typer.echo(f"  {len(examples)} labeled samples")

    if not all_examples:
        typer.echo("Error: no labeled samples found.", err=True)
        raise typer.Exit(code=1)

    n_pos = sum(1 for e in all_examples if e["label"] == 1)
    n_neg = len(all_examples) - n_pos
    typer.echo(
        f"\nTotal: {len(all_examples)} samples ({n_pos} positive, {n_neg} negative)"
    )

    features = Features(
        {
            "image": Image(),
            "label": ClassLabel(names=["absent", "present"]),
            "pos": Value("string"),
            "crop": Value("string"),
            "t": Value("int32"),
        }
    )

    ds = Dataset.from_list(all_examples, features=features)
    ds.save_to_disk(str(output))
    typer.echo(f"Saved dataset to {output}")


# ---------------------------------------------------------------------------
# Train command
# ---------------------------------------------------------------------------


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
    import evaluate
    from datasets import load_from_disk
    from transformers import (
        AutoImageProcessor,
        AutoModelForImageClassification,
        Trainer,
        TrainingArguments,
    )

    def _make_transforms(processor: AutoImageProcessor):
        def transforms(examples: dict) -> dict:
            images = []
            for img in examples["image"]:
                if img.mode != "RGB":
                    img = img.convert("RGB")
                images.append(img)
            inputs = processor(images, return_tensors="pt")
            inputs["labels"] = examples["label"]
            return inputs

        return transforms

    typer.echo("Loading dataset...")
    ds = load_from_disk(str(dataset))

    ds_split = ds.train_test_split(test_size=split, seed=42, stratify_by_column="label")
    train_ds = ds_split["train"]
    val_ds = ds_split["test"]
    typer.echo(f"Train: {len(train_ds)}, Val: {len(val_ds)}")

    model_name = "microsoft/resnet-18"
    processor = AutoImageProcessor.from_pretrained(model_name)
    model = AutoModelForImageClassification.from_pretrained(
        model_name,
        num_labels=2,
        label2id={"absent": 0, "present": 1},
        id2label={0: "absent", 1: "present"},
        ignore_mismatched_sizes=True,
    )

    transform_fn = _make_transforms(processor)
    train_ds = train_ds.with_transform(transform_fn)
    val_ds = val_ds.with_transform(transform_fn)

    accuracy = evaluate.load("accuracy")
    f1 = evaluate.load("f1")

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = np.argmax(logits, axis=-1)
        acc = accuracy.compute(predictions=preds, references=labels)
        f1_score = f1.compute(predictions=preds, references=labels)
        return {**acc, **f1_score}

    training_args = TrainingArguments(
        output_dir=str(output),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=lr,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_steps=10,
        remove_unused_columns=False,
        seed=42,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        compute_metrics=compute_metrics,
    )

    typer.echo("Training...")
    trainer.train()

    typer.echo("Saving best model...")
    trainer.save_model(str(output / "best"))
    processor.save_pretrained(str(output / "best"))

    metrics = trainer.evaluate()
    typer.echo(f"Final metrics: {metrics}")
    typer.echo(f"Model saved to {output / 'best'}")


# ---------------------------------------------------------------------------
# Predict command
# ---------------------------------------------------------------------------


def _predict_position(
    zarr_path: Path,
    pos: int,
    model,
    processor,
    device,
    batch_size: int,
    t_range: tuple[int, int] | None,
    crop_range: tuple[int, int] | None,
) -> list[dict]:
    """Run inference on (crop, t) pairs for a position."""
    import torch

    store = zarr.DirectoryStore(str(zarr_path))
    root = zarr.open_group(store, mode="r")

    crop_grp = root[f"pos/{pos:03d}/crop"]
    crop_ids = sorted(crop_grp.keys())

    if crop_range is not None:
        crop_ids = [c for c in crop_ids if crop_range[0] <= int(c) < crop_range[1]]

    results: list[dict] = []
    batch_imgs: list[PILImage.Image] = []
    batch_meta: list[tuple[int, str]] = []

    def _run_batch(images, model, processor, device) -> list[bool]:
        inputs = processor(images, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs)
        preds = torch.argmax(outputs.logits, dim=-1).cpu().tolist()
        return [bool(p) for p in preds]

    for crop_id in track(crop_ids, description=f"  Pos {pos}"):
        arr = crop_grp[crop_id]
        n_times = arr.shape[0]

        t_start = t_range[0] if t_range else 0
        t_end = min(t_range[1], n_times) if t_range else n_times

        for t in range(t_start, t_end):
            frame = np.array(arr[t, 0, 0])
            lo, hi = float(frame.min()), float(frame.max())
            if hi > lo:
                normalized = ((frame - lo) / (hi - lo) * 255).astype(np.uint8)
            else:
                normalized = np.zeros_like(frame, dtype=np.uint8)

            img = PILImage.fromarray(normalized, mode="L").convert("RGB")
            batch_imgs.append(img)
            batch_meta.append((t, crop_id))

            if len(batch_imgs) >= batch_size:
                preds = _run_batch(batch_imgs, model, processor, device)
                for (bt, bc), pred in zip(batch_meta, preds):
                    results.append({"t": bt, "crop": bc, "label": pred})
                batch_imgs.clear()
                batch_meta.clear()

    if batch_imgs:
        preds = _run_batch(batch_imgs, model, processor, device)
        for (bt, bc), pred in zip(batch_meta, preds):
            results.append({"t": bt, "crop": bc, "label": pred})

    return results


@app.command()
def predict(
    config: Annotated[
        Path,
        typer.Option(
            exists=True,
            dir_okay=False,
            help="YAML config with zarr path, positions, and optional ranges.",
        ),
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
) -> None:
    """Run inference on crops.zarr positions and write predictions CSV."""
    import torch
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    with open(config) as f:
        cfg = yaml.safe_load(f)

    typer.echo(f"Loading model from {model}")
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    loaded_model = AutoModelForImageClassification.from_pretrained(str(model))
    loaded_model.to(device)
    loaded_model.eval()
    processor = AutoImageProcessor.from_pretrained(str(model))
    typer.echo(f"  Device: {device}")

    all_results: list[dict] = []

    for source in cfg["sources"]:
        zarr_path = Path(source["zarr"])
        pos = int(source["pos"])

        t_range = tuple(source["t_range"]) if "t_range" in source else None
        crop_range = tuple(source["crop_range"]) if "crop_range" in source else None

        n_crops_desc = (
            f"crops {crop_range[0]}-{crop_range[1]}" if crop_range else "all crops"
        )
        n_t_desc = f"t={t_range[0]}-{t_range[1]}" if t_range else "all t"
        typer.echo(f"Predicting pos {pos} ({n_crops_desc}, {n_t_desc})")

        results = _predict_position(
            zarr_path,
            pos,
            loaded_model,
            processor,
            device,
            batch_size,
            t_range,
            crop_range,
        )
        all_results.extend(results)

        n_present = sum(1 for r in results if r["label"])
        n_absent = len(results) - n_present
        typer.echo(
            f"  {len(results)} predictions ({n_present} present, {n_absent} absent)"
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,label\n")
        for r in all_results:
            fh.write(f"{r['t']},{r['crop']},{str(r['label']).lower()}\n")

    typer.echo(f"\nWrote {len(all_results)} predictions to {output}")


# ---------------------------------------------------------------------------
# Plot command
# ---------------------------------------------------------------------------


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
    df = _load_csv(input)

    n_crops = df["crop"].nunique()
    max_t = df["t"].max()
    typer.echo(f"Loaded {len(df)} predictions, {n_crops} crops, t=0..{max_t}")

    n_present = df.groupby("t")["label"].sum().sort_index()

    death_times = []
    empty_at_t0 = 0
    for crop_id, group in df.groupby("crop"):
        group = group.sort_values("t")
        first_false = group.loc[~group["label"], "t"]
        if len(first_false) > 0:
            t_death = first_false.iloc[0]
            if t_death == 0:
                empty_at_t0 += 1
            else:
                death_times.append(t_death)

    fig, (ax_curve, ax_hist) = plt.subplots(
        1,
        2,
        figsize=(12, 4),
        gridspec_kw={"width_ratios": [2, 1], "wspace": 0.3},
    )

    ax_curve.plot(n_present.index, n_present.values, color="steelblue", linewidth=2)
    ax_curve.fill_between(
        n_present.index, 0, n_present.values, alpha=0.15, color="steelblue"
    )
    ax_curve.set_xlabel("t")
    ax_curve.set_ylabel("n cells")
    ax_curve.set_title("Kill curve")
    ax_curve.set_xlim(0, max_t)
    ax_curve.set_ylim(0, None)

    if death_times:
        ax_hist.hist(
            death_times,
            bins=range(1, max_t + 2),
            color="tomato",
            edgecolor="white",
            alpha=0.8,
        )
    ax_hist.set_xlabel("t (death)")
    ax_hist.set_ylabel("n crops")
    ax_hist.set_title("Death time distribution")
    ax_hist.set_xlim(0, max_t)

    n_never = n_crops - len(death_times) - empty_at_t0
    typer.echo(
        f"Deaths: {len(death_times)} crops died, {n_never} survived, {empty_at_t0} empty at t=0"
    )

    plt.savefig(output, dpi=150, bbox_inches="tight")
    typer.echo(f"Saved plot to {output}")

    violations = _find_violations(df)
    n_noisy = violations["crop"].nunique() if len(violations) > 0 else 0
    typer.echo(f"Violations: {len(violations)} rows across {n_noisy} crops")


# ---------------------------------------------------------------------------
# Clean command
# ---------------------------------------------------------------------------


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
    df = _load_csv(input)
    typer.echo(f"Loaded {len(df)} predictions")

    violations = _find_violations(df)
    n_violations = len(violations)
    noisy_crops = violations["crop"].unique() if n_violations > 0 else []

    if n_violations == 0:
        typer.echo("No violations found, already clean.")
        df["label"] = df["label"].apply(lambda x: "true" if x else "false")
        df.to_csv(output, index=False)
        typer.echo(f"Wrote {len(df)} rows to {output}")
        return

    typer.echo(f"Found {n_violations} violations across {len(noisy_crops)} crops:")
    for crop_id in sorted(noisy_crops):
        crop_violations = violations[violations["crop"] == crop_id]
        ts = sorted(crop_violations["t"].tolist())
        typer.echo(f"  crop {crop_id}: resurrects at t={ts}")

    cleaned, report = _clean_df(df)
    typer.echo(f"Corrected {len(report)} rows (forced to absent)")

    cleaned["label"] = cleaned["label"].apply(lambda x: "true" if x else "false")
    cleaned.to_csv(output, index=False)
    typer.echo(f"Wrote {len(cleaned)} rows to {output}")


if __name__ == "__main__":
    app()

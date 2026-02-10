"""mukill core – shared logic for dataset, train, predict, plot, clean. Used by CLI and GUI."""

from __future__ import annotations

import csv
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
import zarr
from PIL import Image as PILImage

ProgressCallback = Callable[[float, str], None]


def _load_csv(csv_path: Path) -> pd.DataFrame:
    """Load a predictions/annotations CSV (t,crop,label) into a DataFrame."""
    df = pd.read_csv(csv_path, dtype={"crop": str})
    if df["label"].dtype == object:
        df["label"] = df["label"].map({"true": True, "false": False})
    else:
        df["label"] = df["label"].astype(bool)
    return df


def _load_annotations(csv_path: Path) -> dict[str, bool]:
    """Load annotations CSV → {"t:cropId": bool}."""
    annotations: dict[str, bool] = {}
    with open(csv_path, newline="") as fh:
        for row in csv.DictReader(fh):
            key = f"{row['t']}:{row['crop']}"
            annotations[key] = row["label"] == "true"
    return annotations


def _find_violations(df: pd.DataFrame) -> pd.DataFrame:
    """Find crops that violate monotonicity."""
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


def run_dataset(
    zarr_path: Path,
    pos: int,
    annotations_path: Path,
    output: Path,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Create a HuggingFace Dataset from crops.zarr + annotations CSV."""
    from datasets import ClassLabel, Dataset, Features, Image, Value

    ann_dict = _load_annotations(annotations_path)

    store = zarr.DirectoryStore(str(zarr_path))
    root = zarr.open_group(store, mode="r")
    crop_grp = root[f"pos/{pos:03d}/crop"]
    crop_ids = sorted(crop_grp.keys())

    examples = []
    total = len(crop_ids)
    for i, crop_id in enumerate(crop_ids):
        arr = crop_grp[crop_id]
        n_times = arr.shape[0]

        for t in range(n_times):
            key = f"{t}:{crop_id}"
            if key not in ann_dict:
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
                    "label": int(ann_dict[key]),
                    "pos": str(pos),
                    "crop": crop_id,
                    "t": t,
                }
            )

        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Processing crop {i + 1}/{total}")

    if not examples:
        raise ValueError("No labeled samples found")

    features = Features(
        {
            "image": Image(),
            "label": ClassLabel(names=["absent", "present"]),
            "pos": Value("string"),
            "crop": Value("string"),
            "t": Value("int32"),
        }
    )

    ds = Dataset.from_list(examples, features=features)
    ds.save_to_disk(str(output))

    if on_progress:
        on_progress(1.0, f"Saved dataset to {output}")


def run_train(
    dataset_path: Path,
    output: Path,
    epochs: int = 20,
    batch_size: int = 32,
    lr: float = 1e-4,
    split: float = 0.2,
    *,
    on_progress: ProgressCallback | None = None,
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

    def _make_transforms(processor):
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

    if on_progress:
        on_progress(0.1, "Loading dataset...")
    ds = load_from_disk(str(dataset_path))
    ds_split = ds.train_test_split(test_size=split, seed=42, stratify_by_column="label")
    train_ds = ds_split["train"]
    val_ds = ds_split["test"]

    model_name = "microsoft/resnet-18"
    if on_progress:
        on_progress(0.2, "Loading model...")
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

    if on_progress:
        on_progress(0.3, "Training...")
    trainer.train()

    if on_progress:
        on_progress(0.95, "Saving model...")
    trainer.save_model(str(output / "best"))
    processor.save_pretrained(str(output / "best"))

    if on_progress:
        on_progress(1.0, f"Model saved to {output / 'best'}")


def _predict_position(
    zarr_path: Path,
    pos: int,
    model,
    processor,
    device,
    batch_size: int,
    t_range: tuple[int, int] | None,
    crop_range: tuple[int, int] | None,
    on_progress: ProgressCallback | None,
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

    total = len(crop_ids)
    for i, crop_id in enumerate(crop_ids):
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

        if on_progress and total > 0:
            on_progress((i + 1) / total, f"Predicting crop {i + 1}/{total}")

    if batch_imgs:
        preds = _run_batch(batch_imgs, model, processor, device)
        for (bt, bc), pred in zip(batch_meta, preds):
            results.append({"t": bt, "crop": bc, "label": pred})

    return results


def run_predict(
    zarr_path: Path,
    pos: int,
    model_path: str,
    output: Path,
    batch_size: int = 64,
    t_start: int | None = None,
    t_end: int | None = None,
    crop_start: int | None = None,
    crop_end: int | None = None,
    *,
    on_progress: ProgressCallback | None = None,
) -> None:
    """Run inference on crops.zarr positions and write predictions CSV."""
    import torch
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    loaded_model = AutoModelForImageClassification.from_pretrained(str(model_path))
    loaded_model.to(device)
    loaded_model.eval()
    processor = AutoImageProcessor.from_pretrained(str(model_path))

    t_range = None
    if t_start is not None and t_end is not None:
        t_range = (t_start, t_end)
    elif t_start is not None or t_end is not None:
        raise ValueError("Both t_start and t_end must be provided if using time range")

    crop_range = None
    if crop_start is not None and crop_end is not None:
        crop_range = (crop_start, crop_end)
    elif crop_start is not None or crop_end is not None:
        raise ValueError("Both crop_start and crop_end must be provided if using crop range")

    results = _predict_position(
        zarr_path,
        pos,
        loaded_model,
        processor,
        device,
        batch_size,
        t_range,
        crop_range,
        on_progress,
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,label\n")
        for r in results:
            fh.write(f"{r['t']},{r['crop']},{str(r['label']).lower()}\n")

    if on_progress:
        on_progress(1.0, f"Wrote {len(results)} predictions to {output}")


def run_plot(input_csv: Path, output: Path) -> None:
    """Plot kill curve: number of present cells over time."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    df = _load_csv(input_csv)
    n_crops = df["crop"].nunique()
    max_t = df["t"].max()
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
        1, 2, figsize=(12, 4), gridspec_kw={"width_ratios": [2, 1], "wspace": 0.3}
    )

    ax_curve.plot(n_present.index, n_present.values, color="steelblue", linewidth=2)
    ax_curve.fill_between(n_present.index, 0, n_present.values, alpha=0.15, color="steelblue")
    ax_curve.set_xlabel("t")
    ax_curve.set_ylabel("n cells")
    ax_curve.set_title("Kill curve")
    ax_curve.set_xlim(0, max_t)
    ax_curve.set_ylim(0, None)

    if death_times:
        ax_hist.hist(death_times, bins=range(1, max_t + 2), color="tomato", edgecolor="white", alpha=0.8)
    ax_hist.set_xlabel("t (death)")
    ax_hist.set_ylabel("n crops")
    ax_hist.set_title("Death time distribution")
    ax_hist.set_xlim(0, max_t)

    output.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output, dpi=150, bbox_inches="tight")
    plt.close()


def run_clean(input_csv: Path, output: Path) -> None:
    """Clean predictions by enforcing monotonicity."""
    df = _load_csv(input_csv)
    cleaned, report = _clean_df(df)
    cleaned["label"] = cleaned["label"].apply(lambda x: "true" if x else "false")
    cleaned.to_csv(output, index=False)

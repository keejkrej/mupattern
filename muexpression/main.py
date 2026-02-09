"""muexpression – measure fluorescence expression in micropattern crops.

Commands:
    muexpression analyze --config config.yaml --output expression.csv
    muexpression plot --input expression.csv --output expression.png
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import matplotlib
import numpy as np
import pandas as pd
import typer
import yaml
import zarr
from rich.progress import track

matplotlib.use("Agg")
import matplotlib.pyplot as plt

app = typer.Typer(
    add_completion=False,
    help="Measure fluorescence expression in micropattern crops.",
)


@app.command()
def analyze(
    config: Annotated[
        Path,
        typer.Option(
            exists=True,
            dir_okay=False,
            help="YAML config listing zarr sources with pos and channel.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output CSV file path."),
    ],
) -> None:
    """Sum pixel intensities per crop per timepoint and write a CSV."""
    with open(config) as f:
        cfg = yaml.safe_load(f)

    rows: list[tuple[int, str, int, float]] = []

    for source in cfg["sources"]:
        zarr_path = Path(source["zarr"])
        pos = int(source["pos"])
        channel = int(source["channel"])

        typer.echo(f"Processing pos {pos:03d}, channel {channel} from {zarr_path}")

        store = zarr.DirectoryStore(str(zarr_path))
        root = zarr.open_group(store, mode="r")
        crop_grp = root[f"pos/{pos:03d}/crop"]
        crop_ids = sorted(crop_grp.keys())

        bg_arr = root[f"pos/{pos:03d}/background"]

        for crop_id in track(crop_ids, description=f"  Pos {pos:03d}"):
            arr = crop_grp[crop_id]
            n_times = arr.shape[0]

            for t in range(n_times):
                intensity = int(np.array(arr[t, channel, 0]).sum())
                background = float(bg_arr[t, channel, 0])
                rows.append((t, crop_id, intensity, background))

    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", newline="") as fh:
        fh.write("t,crop,intensity,background\n")
        for t, crop, intensity, background in rows:
            fh.write(f"{t},{crop},{intensity},{background}\n")

    typer.echo(f"Wrote {len(rows)} rows to {output}")


@app.command()
def plot(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            dir_okay=False,
            help="CSV from 'muexpression analyze' (t,crop,intensity,background).",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output plot image path (e.g. expression.png)."),
    ],
) -> None:
    """Plot intensity over time for every crop (raw and background-subtracted)."""
    df = pd.read_csv(input, dtype={"crop": str})
    n_crops = df["crop"].nunique()
    max_t = df["t"].max()
    typer.echo(f"Loaded {len(df)} rows, {n_crops} crops, t=0..{max_t}")

    fig, (ax_raw, ax_sub) = plt.subplots(
        1, 2, figsize=(12, 4), sharey=False,
        gridspec_kw={"wspace": 0.3},
    )

    for _crop_id, group in df.groupby("crop"):
        group = group.sort_values("t")
        ax_raw.plot(group["t"], group["intensity"], linewidth=0.5, alpha=0.4)
        ax_sub.plot(
            group["t"],
            group["intensity"] - group["background"],
            linewidth=0.5,
            alpha=0.4,
        )

    ax_raw.set_xlabel("t")
    ax_raw.set_ylabel("intensity")
    ax_raw.set_title("Raw intensity")
    ax_raw.set_xlim(0, max_t)

    ax_sub.set_xlabel("t")
    ax_sub.set_ylabel("intensity − background")
    ax_sub.set_title("Background-subtracted")
    ax_sub.set_xlim(0, max_t)

    output.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output, dpi=150, bbox_inches="tight")
    typer.echo(f"Saved plot to {output}")


if __name__ == "__main__":
    app()

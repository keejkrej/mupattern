"""mufile – microscopy file utilities.

Commands:

* ``mufile crop``    — crop micropattern positions from TIFFs into zarr stacks.
* ``mufile convert`` — convert an ND2 file into per-position TIFF folders.
* ``mufile movie``   — create a movie from a zarr crop.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

import typer

from .core import (
    _read_bbox_csv,
    parse_slice_string,
    run_convert,
    run_crop,
    run_movie,
)

app = typer.Typer(add_completion=False)


def _progress_echo(progress: float, message: str) -> None:
    typer.echo(message)


@app.command()
def crop(
    input_dir: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            file_okay=False,
            help="Root folder containing Pos* subdirectories.",
        ),
    ],
    pos: Annotated[
        int,
        typer.Option(help="Position number (e.g. 150 reads Pos150/)."),
    ],
    bbox: Annotated[
        Path,
        typer.Option(
            exists=True,
            dir_okay=False,
            help="Path to the bounding-box CSV exported by mupattern.",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output zarr store path (e.g. crops.zarr)."),
    ],
    background: Annotated[
        bool,
        typer.Option(help="Compute per-frame background (median outside crops)."),
    ],
) -> None:
    """Crop pattern positions from microscopy TIFFs into a zarr store."""
    bbox_list = _read_bbox_csv(bbox)
    typer.echo(f"Loaded {len(bbox_list)} bounding boxes from {bbox}")

    try:
        run_crop(input_dir, pos, bbox, output, background, on_progress=_progress_echo)
    except (FileNotFoundError, ValueError) as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e


@app.command()
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
    """Convert an ND2 file into per-position TIFF folders.

    Output layout::

        output/
          Pos140/
            time_map.csv
            img_channel000_position140_time000000000_z000.tif
          Pos150/
            ...
    """
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
    pos_names = [f"Pos{i}" for i in range(n_pos)]
    try:
        f2 = nd2.ND2File(str(input))
        exp = f2.experiment
        if exp:
            for loop in exp:
                if loop.type == "XYPosLoop":
                    pos_names = [p.name for p in loop.parameters.points]
                    break
        f2.close()
    except Exception:
        pass

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
    typer.echo(f"  {', '.join(pos_names[i] for i in pos_indices)}")
    typer.echo("")
    typer.echo("Timepoints (original indices):")
    typer.echo(f"  {time_indices}")
    typer.echo("")

    if not typer.confirm("Proceed with conversion?"):
        raise typer.Abort()

    try:
        run_convert(input, pos, time, output, on_progress=_progress_echo)
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e


@app.command()
def movie(
    input: Annotated[
        Path,
        typer.Option(
            "--input",
            exists=True,
            file_okay=False,
            help="Path to zarr store.",
        ),
    ],
    pos: Annotated[
        int,
        typer.Option(help="Position number."),
    ],
    crop: Annotated[
        int,
        typer.Option(help="Crop number."),
    ],
    channel: Annotated[
        int,
        typer.Option(help="Channel number."),
    ],
    time: Annotated[
        str,
        typer.Option(
            help='Timepoints to include: "all" or comma-separated indices/slices, e.g. "1:10:2, 3, 6".',
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(help="Output movie file path (e.g. movie.mp4)."),
    ],
    fps: Annotated[
        int,
        typer.Option(help="Frames per second."),
    ],
    colormap: Annotated[
        Literal["grayscale", "hot", "viridis"],
        typer.Option(
            help='Colormap to apply: "grayscale", "hot", or "viridis".',
        ),
    ],
    spots: Annotated[
        Path | None,
        typer.Option(
            "--spots",
            exists=True,
            dir_okay=False,
            help="Optional spots CSV (t,crop,spot,y,x) from muspot detect to overlay. Frames/crops not in CSV skip overlay.",
        ),
    ] = None,
) -> None:
    """Create a movie from a zarr crop."""
    try:
        run_movie(
            input,
            pos,
            crop,
            channel,
            time,
            output,
            fps,
            colormap,
            spots,
            on_progress=_progress_echo,
        )
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(code=1) from e

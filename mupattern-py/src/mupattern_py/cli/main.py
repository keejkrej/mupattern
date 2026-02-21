"""mupattern CLI – convert, crop, movie, expression, kill, spot, tissue, plot, train, dataset."""

from __future__ import annotations

import typer

from .convert import app as convert_app
from .crop import crop
from .dataset import app as dataset_app
from .expression import expression
from .kill import kill
from .movie import movie
from .plot import app as plot_app
from .spot import spot
from .tissue import tissue
from .train import app as train_app

app = typer.Typer(
    add_completion=False,
    help="mupattern CLI: convert, crop, movie, expression, kill, spot, tissue, plot, train, dataset",
)

app.add_typer(convert_app, name="convert")
app.command("crop")(crop)
app.command("movie")(movie)
app.command("expression")(expression)
app.command("spot")(spot)
app.command("tissue")(tissue)

app.command("kill")(kill)
app.add_typer(plot_app, name="plot")
app.add_typer(train_app, name="train")
app.add_typer(dataset_app, name="dataset")


if __name__ == "__main__":
    app()

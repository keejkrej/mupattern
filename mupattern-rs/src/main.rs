mod convert;
mod crop;
mod expression;
mod movie;
mod slices;
mod zarr;

use clap::{Parser, Subcommand};
use std::io::{self, Write};

#[derive(Parser)]
#[command(name = "mupattern", about = "mupattern CLI: crop, convert, expression, movie")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Convert(convert::ConvertArgs),
    Crop(crop::CropArgs),
    Expression(expression::ExpressionArgs),
    Movie(movie::MovieArgs),
}

fn progress(prog: f64, msg: &str) {
    let _ = writeln!(
        io::stderr(),
        "{}",
        serde_json::json!({"progress": prog, "message": msg})
    );
    let _ = io::stderr().flush();
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Convert(args) => convert::run(args, progress)?,
        Commands::Crop(args) => crop::run(args, progress)?,
        Commands::Expression(args) => expression::run(args, progress)?,
        Commands::Movie(args) => movie::run(args, progress)?,
    }
    Ok(())
}

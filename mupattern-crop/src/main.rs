mod crop;
mod zarr;

use clap::Parser;
use std::io::{self, Write};

#[derive(Parser)]
#[command(
    name = "mupattern-crop",
    about = "Crop MuPattern TIFF position folders into crops.zarr"
)]
struct Cli {
    #[command(flatten)]
    args: crop::CropArgs,
}

fn progress(progress: f64, message: &str) {
    let _ = writeln!(
        io::stderr(),
        "{}",
        serde_json::json!({ "progress": progress, "message": message })
    );
    let _ = io::stderr().flush();
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    crop::run(cli.args, progress)?;
    Ok(())
}

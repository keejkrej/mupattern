use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "mupattern",
    about = "mupattern CLI: crop, convert, expression, kill, movie, spot, tissue"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Convert(mupattern_rs::convert::ConvertArgs),
    Crop(mupattern_rs::crop::CropArgs),
    Expression(mupattern_rs::expression::ExpressionArgs),
    Kill(mupattern_rs::kill::KillArgs),
    Movie(mupattern_rs::movie::MovieArgs),
    Spot(mupattern_rs::spot::SpotArgs),
    Tissue(mupattern_rs::tissue::TissueArgs),
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Convert(args) => mupattern_rs::convert::run(args, mupattern_rs::stderr_progress)?,
        Commands::Crop(args) => mupattern_rs::crop::run(args, mupattern_rs::stderr_progress)?,
        Commands::Expression(args) => {
            mupattern_rs::expression::run(args, mupattern_rs::stderr_progress)?
        }
        Commands::Kill(args) => mupattern_rs::kill::run(args, mupattern_rs::stderr_progress)?,
        Commands::Movie(args) => mupattern_rs::movie::run(args, mupattern_rs::stderr_progress)?,
        Commands::Spot(args) => mupattern_rs::spot::run(args, mupattern_rs::stderr_progress)?,
        Commands::Tissue(args) => mupattern_rs::tissue::run(args, mupattern_rs::stderr_progress)?,
    }
    Ok(())
}

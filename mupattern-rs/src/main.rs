use clap::{Parser, Subcommand};
use std::io::{self, Write};

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
        Commands::Convert(args) => {
            let plan = mupattern_rs::convert::plan(&args)?;
            eprintln!("ND2: {} positions, T={}, C={}, Z={}", plan.n_pos, plan.n_time, plan.n_chan, plan.n_z);
            eprintln!();
            eprintln!(
                "Selected {}/{} positions, {}/{} timepoints, {} channels, {} z-slices",
                plan.positions.len(),
                plan.n_pos,
                plan.time_indices.len(),
                plan.n_time,
                plan.n_chan,
                plan.n_z
            );
            eprintln!("Total frames to write: {}", plan.total_frames);
            eprintln!();
            eprintln!("Positions:");
            eprintln!(
                "  {}",
                plan.positions
                    .iter()
                    .map(|i| format!("Pos{}", i))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            eprintln!();
            eprintln!("Timepoints (original indices):");
            eprintln!("  {:?}", plan.time_indices);
            eprintln!();

            if args.dry_run {
                eprintln!("Dry-run requested, exiting without conversion.");
                return Ok(());
            }

            if !args.yes && !confirm_execution("Proceed with conversion? [y/N]: ")? {
                eprintln!("Aborted");
                return Ok(());
            }

            mupattern_rs::convert::run(args, mupattern_rs::stderr_progress)?;
        }
        Commands::Crop(args) => {
            let plan = mupattern_rs::crop::plan(&args)?;
            eprintln!("Input: {}", plan.pos);
            eprintln!(
                "BBoxes: {} | input TIFFs: {} | output frames: {}",
                plan.n_bboxes, plan.n_input_frames, plan.total_output_frames
            );
            eprintln!("Channels: {}", plan.n_channels);
            eprintln!("Times: {}", plan.n_times);
            eprintln!("Z-slices: {}", plan.n_z);
            if args.dry_run {
                eprintln!("Dry-run requested, exiting without execution.");
                return Ok(());
            }
            if !args.yes && !confirm_execution("Proceed with cropping? [y/N]: ")? {
                eprintln!("Aborted");
                return Ok(());
            }
            mupattern_rs::crop::run(args, mupattern_rs::stderr_progress)?;
        }
        Commands::Expression(args) => {
            let plan = mupattern_rs::expression::plan(&args)?;
            eprintln!("Pos{} channel {}: {} crops, {} crop/timepoints", plan.pos, plan.channel, plan.n_crops, plan.n_times);
            eprintln!("Estimated rows: {}", plan.total_rows);
            if args.dry_run {
                eprintln!("Dry-run requested, exiting without execution.");
                return Ok(());
            }
            if !args.yes && !confirm_execution("Proceed with expression analysis? [y/N]: ")? {
                eprintln!("Aborted");
                return Ok(());
            }
            mupattern_rs::expression::run(args, mupattern_rs::stderr_progress)?
        }
        Commands::Kill(args) => {
            let plan = mupattern_rs::kill::plan(&args)?;
            eprintln!("Pos{}: {} crops, {} frames", plan.pos, plan.n_crops, plan.n_frames);
            eprintln!(
                "Model: {} | batch size: {}",
                plan.model, plan.batch_size
            );
            if args.dry_run {
                eprintln!("Dry-run requested, exiting without execution.");
                return Ok(());
            }
            if !args.yes && !confirm_execution("Proceed with kill prediction? [y/N]: ")? {
                eprintln!("Aborted");
                return Ok(());
            }
            mupattern_rs::kill::run(args, mupattern_rs::stderr_progress)?
        }
        Commands::Movie(args) => {
            let plan = mupattern_rs::movie::plan(&args)?;
            eprintln!(
                "Pos{}, crop {}, channel {}: {}/{} timepoints",
                plan.pos, plan.crop, plan.channel, plan.selected_times, plan.n_times
            );
            if args.dry_run {
                eprintln!("Dry-run requested, exiting without execution.");
                return Ok(());
            }
            if !args.yes && !confirm_execution("Proceed with movie generation? [y/N]: ")? {
                eprintln!("Aborted");
                return Ok(());
            }
            mupattern_rs::movie::run(args, mupattern_rs::stderr_progress)?
        }
        Commands::Spot(args) => {
            let plan = mupattern_rs::spot::plan(&args)?;
            eprintln!("Pos{}: {}/{} crops", plan.pos, plan.selected_crops, plan.n_crops);
            eprintln!(
                "Channel {}: {} candidate frames",
                plan.channel, plan.n_frames
            );
            if args.dry_run {
                eprintln!("Dry-run requested, exiting without execution.");
                return Ok(());
            }
            if !args.yes && !confirm_execution("Proceed with spot detection? [y/N]: ")? {
                eprintln!("Aborted");
                return Ok(());
            }
            mupattern_rs::spot::run(args, mupattern_rs::stderr_progress)?
        }
        Commands::Tissue(args) => {
            let plan = mupattern_rs::tissue::plan(&args)?;
            eprintln!(
                "Pos{} method {}: {} crops, {} frames",
                plan.pos, plan.method, plan.n_crops, plan.n_frames
            );
            eprintln!(
                "Phase channel: {} | fluorescence channel: {}",
                plan.channel_phase, plan.channel_fluorescence
            );
            if args.dry_run {
                eprintln!("Dry-run requested, exiting without execution.");
                return Ok(());
            }
            if !args.yes && !confirm_execution("Proceed with tissue analysis? [y/N]: ")? {
                eprintln!("Aborted");
                return Ok(());
            }
            mupattern_rs::tissue::run(args, mupattern_rs::stderr_progress)?
        }
    }
    Ok(())
}

fn confirm_execution(prompt: &str) -> Result<bool, Box<dyn std::error::Error>> {
    let mut line = String::new();
    write!(io::stderr(), "{}", prompt)?;
    io::stderr().flush()?;
    io::stdin().read_line(&mut line)?;
    Ok(line.trim().eq_ignore_ascii_case("y") || line.trim().eq_ignore_ascii_case("yes"))
}

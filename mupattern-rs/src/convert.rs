use clap::Args;
use nd2_rs::Nd2File;
use std::fs;
use std::io::BufWriter;
use std::path::Path;

use crate::slices;
use tiff::encoder::{colortype::Gray16, TiffEncoder};

#[derive(Args, Clone)]
pub struct ConvertArgs {
    /// Path to the .nd2 file to convert
    #[arg(long)]
    pub input: String,

    /// Positions to convert: "all" or comma-separated indices/slices, e.g. "0:5, 10"
    #[arg(long)]
    pub pos: String,

    /// Timepoints to convert: "all" or comma-separated indices/slices, e.g. "0:50, 100"
    #[arg(long)]
    pub time: String,

    /// Output directory (will contain Pos*/... TIFF folders)
    #[arg(long)]
    pub output: String,

    /// Skip confirmation prompt
    #[arg(long)]
    pub yes: bool,
}

pub fn run(
    args: ConvertArgs,
    progress: impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let output_path = Path::new(&args.output);

    let mut nd2 = Nd2File::open(&args.input)?;
    let sizes = nd2.sizes()?;

    let n_pos = *sizes.get("P").unwrap_or(&1);
    let n_time = *sizes.get("T").unwrap_or(&1);
    let n_chan = *sizes.get("C").unwrap_or(&1);
    let n_z = *sizes.get("Z").unwrap_or(&1);
    let height = *sizes.get("Y").unwrap_or(&1);
    let width = *sizes.get("X").unwrap_or(&1);

    let pos_indices = slices::parse_slice_string(&args.pos, n_pos)?;
    let time_indices = slices::parse_slice_string(&args.time, n_time)?;

    let total = pos_indices.len() * time_indices.len() * n_chan * n_z;

    eprintln!("ND2: {} positions, T={}, C={}, Z={}", n_pos, n_time, n_chan, n_z);
    eprintln!();
    eprintln!(
        "Selected {}/{} positions, {}/{} timepoints, {} channels, {} z-slices",
        pos_indices.len(),
        n_pos,
        time_indices.len(),
        n_time,
        n_chan,
        n_z
    );
    eprintln!("Total frames to write: {}", total);
    eprintln!();
    eprintln!("Positions:");
    eprintln!("  {}", pos_indices.iter().map(|i| format!("Pos{}", i)).collect::<Vec<_>>().join(", "));
    eprintln!();
    eprintln!("Timepoints (original indices):");
    eprintln!("  {:?}", time_indices);
    eprintln!();

    if !args.yes {
        eprint!("Proceed with conversion? [y/N]: ");
        use std::io::{self, Write};
        io::stdout().flush()?;
        let mut line = String::new();
        io::stdin().read_line(&mut line)?;
        if !line.trim().eq_ignore_ascii_case("y") && !line.trim().eq_ignore_ascii_case("yes") {
            return Err("Aborted".into());
        }
    }

    fs::create_dir_all(output_path)?;

    let mut done: usize = 0;
    for &p_idx in &pos_indices {
        let pos_dir = output_path.join(format!("Pos{}", p_idx));
        fs::create_dir_all(&pos_dir)?;

        let time_map_path = pos_dir.join("time_map.csv");
        let mut csv = BufWriter::new(fs::File::create(&time_map_path)?);
        use std::io::Write;
        writeln!(csv, "t,t_real")?;
        for (t_new, &t_orig) in time_indices.iter().enumerate() {
            writeln!(csv, "{},{}", t_new, t_orig)?;
        }
        csv.flush()?;

        for (t_new, &t_orig) in time_indices.iter().enumerate() {
            for c in 0..n_chan {
                for z in 0..n_z {
                    let channel_data = nd2.read_frame_2d(p_idx, t_orig, c, z)?;

                    let fname = format!(
                        "img_channel{:03}_position{:03}_time{:09}_z{:03}.tif",
                        c, p_idx, t_new, z
                    );
                    let tiff_path = pos_dir.join(&fname);
                    let file = fs::File::create(&tiff_path)?;
                    let mut writer = BufWriter::new(file);
                    let mut encoder = TiffEncoder::new(&mut writer)?;
                    encoder.write_image::<Gray16>(width as u32, height as u32, &channel_data)?;

                    done += 1;
                    if total > 0 {
                        progress(done as f64 / total as f64, &format!("Writing TIFFs {}/{}", done, total));
                    }
                }
            }
        }
    }

    progress(1.0, &format!("Wrote {}", output_path.display()));
    Ok(())
}

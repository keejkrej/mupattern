use clap::Args;
use std::fs;
use std::path::Path;

use crate::zarr;

#[derive(Args, Clone)]
pub struct ExpressionArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub channel: u32,
    #[arg(long)]
    pub output: String,
}

pub fn run(
    args: ExpressionArgs,
    progress: impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let crops_zarr = Path::new(&args.input);
    let pos_id = format!("{:03}", args.pos);
    let crop_root = crops_zarr.join("pos").join(&pos_id).join("crop");

    if !crop_root.exists() {
        if !args.output.is_empty() {
            fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
            fs::write(&args.output, "t,crop,intensity,area,background\n")?;
        }
        return Ok(());
    }

    let mut crop_ids: Vec<String> = fs::read_dir(&crop_root)?
        .filter_map(|e| {
            let e = e.ok()?;
            if e.file_type().ok()?.is_dir() {
                e.file_name().to_str().map(String::from)
            } else {
                None
            }
        })
        .collect();
    crop_ids.sort();

    if crop_ids.is_empty() {
        if !args.output.is_empty() {
            fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
            fs::write(&args.output, "t,crop,intensity,area,background\n")?;
        }
        return Ok(());
    }

    let store = zarr::open_store(&crops_zarr)?;

    let bg_path = format!("/pos/{}/background", pos_id);
    let mut backgrounds: Vec<u16> = Vec::new();
    if let Ok(bg_arr) = zarr::open_array(&store, &bg_path) {
        let shape = bg_arr.shape();
        if shape.len() >= 2 && args.channel < shape[1] as u32 {
            let n_t = shape[0];
            for t in 0..n_t {
                let chunk_indices = vec![t, args.channel as u64, 0];
                backgrounds.push(
                    zarr::read_chunk_u16(&bg_arr, &chunk_indices)
                        .ok()
                        .and_then(|d| d.first().copied())
                        .unwrap_or(0),
                );
            }
        }
    }

    let total = crop_ids.len();
    let mut rows: Vec<String> = vec!["t,crop,intensity,area,background".to_string()];

    for (i, crop_id) in crop_ids.iter().enumerate() {
        let array_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
        let arr = zarr::open_array(&store, &array_path)?;
        let shape = arr.shape();
        let n_t = shape[0];
        let h = shape[3];
        let w = shape[4];
        let area = h * w;

        for t in 0..n_t {
            let chunk_indices = vec![t, args.channel as u64, 0, 0, 0];
            let data = zarr::read_chunk_u16(&arr, &chunk_indices)?;
            let intensity: u64 = data.iter().map(|&v| v as u64).sum();
            let background = if (t as usize) < backgrounds.len() {
                backgrounds[t as usize]
            } else {
                0
            };
            rows.push(format!("{},{},{},{},{}", t, crop_id, intensity, area, background));
        }

        progress(
            (i + 1) as f64 / total as f64,
            &format!("Processing crop {}/{}", i + 1, total),
        );
    }

    if !args.output.is_empty() {
        fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
        fs::write(&args.output, rows.join("\n"))?;
        progress(1.0, &format!("Wrote {} rows to {}", rows.len() - 1, args.output));
    }
    Ok(())
}

//! Spot detect: fluorescent spot detection in micropattern crops using spotiflow-rs.
//! Output CSV: t,crop,spot,y,x (mirrors mupattern-py spot).

use clap::Args;
use spotiflow_rs::{PredictParams, SpotiflowSession};
use std::fs;
use std::io::Write;
use std::path::Path;

use crate::slices;
use crate::zarr;

#[derive(Args, Clone)]
pub struct SpotArgs {
    #[arg(long, help = "Path to zarr store (e.g. crops.zarr)")]
    pub input: String,
    #[arg(long, help = "Position number")]
    pub pos: u32,
    #[arg(long, help = "Channel number")]
    pub channel: u32,
    #[arg(long, help = "Output CSV file path")]
    pub output: String,
    #[arg(
        long,
        default_value = "all",
        help = "Crops to process: \"all\" or comma-separated indices/slices, e.g. \"0:10:2, 15\""
    )]
    pub crop: String,
    #[arg(long, help = "Path to spotiflow ONNX model dir (must contain model.onnx)")]
    pub model: String,
    #[arg(long, help = "Force CPU (skip CUDA)")]
    pub cpu: bool,
}

pub fn run(
    args: SpotArgs,
    progress: impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let crops_zarr = Path::new(&args.input);
    let pos_id = format!("{:03}", args.pos);
    let crop_root = crops_zarr.join("pos").join(&pos_id).join("crop");

    if !crop_root.exists() {
        return Err("No crops found for position. Run crop task first.".into());
    }

    let mut all_crop_ids: Vec<String> = fs::read_dir(&crop_root)?
        .filter_map(|e| {
            let e = e.ok()?;
            if e.file_type().ok()?.is_dir() {
                e.file_name().to_str().map(String::from)
            } else {
                None
            }
        })
        .collect();
    all_crop_ids.sort();

    if all_crop_ids.is_empty() {
        return Err("No crops found for position.".into());
    }

    let crop_indices = slices::parse_slice_string(&args.crop, all_crop_ids.len())?;
    let crop_ids: Vec<&String> = crop_indices
        .iter()
        .map(|&i| &all_crop_ids[i])
        .collect();

    let model_path = Path::new(&args.model).join("model.onnx");
    if !model_path.exists() {
        return Err(format!(
            "Model not found at {}. Spotiflow ONNX model must be at {{model}}/model.onnx",
            model_path.display()
        )
        .into());
    }

    progress(0.0, "Loading spotiflow model...");
    let mut session = SpotiflowSession::new(&model_path, args.cpu)?;

    let store = zarr::open_store(crops_zarr)?;
    let total = crop_ids.len();
    let mut rows: Vec<(u64, String, usize, f32, f32)> = Vec::new();

    for (i, crop_id) in crop_ids.iter().enumerate() {
        let array_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
        let arr = zarr::open_array(&store, &array_path)?;
        let shape = arr.shape();
        let n_t = shape[0];
        let h = shape[3];
        let w = shape[4];

        for t in 0..n_t {
            let chunk_indices = vec![t, args.channel as u64, 0, 0, 0];
            let data = zarr::read_chunk_u16(&arr, &chunk_indices)?;
            let img_f32: Vec<f32> = data.iter().map(|&v| v as f32).collect();

            let params = PredictParams {
                tile: None,
                ..Default::default()
            };
            let (spots, _heatmaps, _flows) =
                session.predict(&img_f32, h as usize, w as usize, params)?;

            for (spot_idx, (y, x)) in spots.into_iter().enumerate() {
                rows.push((t, crop_id.to_string(), spot_idx, y, x));
            }
        }

        progress(
            (i + 1) as f64 / total as f64,
            &format!("Processing crop {}/{}", i + 1, total),
        );
    }

    let out_path = Path::new(&args.output);
    fs::create_dir_all(out_path.parent().unwrap_or(Path::new(".")))?;
    let mut fh = fs::File::create(out_path)?;
    fh.write_all(b"t,crop,spot,y,x\n")?;
    for (t, crop, spot, y, x) in &rows {
        writeln!(fh, "{},{},{},{:.2},{:.2}", t, crop, spot, y, x)?;
    }
    progress(1.0, &format!("Wrote {} rows to {}", rows.len(), args.output));

    Ok(())
}

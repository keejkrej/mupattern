//! Tissue: segment cells with Cellpose or CellSAM (ONNX) + per-cell fluorescence analysis.
//!
//! Pipeline:
//!   For each crop × frame:
//!     1. Preprocess: stack [phase, fluo, phase] as 3-ch float32.
//!     2. ONNX inference via cellpose-rs or cellsam-rs.
//!     3. Post-process → integer mask.
//!   Write masks to masks.zarr.
//!   Then analyze: per-cell total_fluorescence, cell_area, background → CSV.

use clap::Args;
use cellpose_rs::{CellposeSession, SegmentParams as CellposeParams};
use cellsam_rs::{CellsamSession, SegmentParams as CellsamParams};
use std::fs;
use std::io::Write;
use std::path::Path;

use crate::zarr;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

#[derive(Args, Clone)]
pub struct TissueArgs {
    /// Path to crops.zarr
    #[arg(long)]
    pub input: String,
    /// Position index
    #[arg(long)]
    pub pos: u32,
    /// Channel index for phase contrast
    #[arg(long)]
    pub channel_phase: u32,
    /// Channel index for fluorescence
    #[arg(long)]
    pub channel_fluorescence: u32,
    /// Segment method: cellpose | cellsam
    #[arg(long, default_value = "cellpose")]
    pub method: String,
    /// Path to model directory. Cellpose: model.onnx. CellSAM: image_encoder.onnx, cellfinder.onnx, mask_decoder.onnx, image_pe.npy
    #[arg(long)]
    pub model: String,
    /// Output CSV path (t,crop,cell,total_fluorescence,cell_area,background)
    #[arg(long)]
    pub output: String,
    /// Output masks zarr path (default: same dir as output / masks.zarr)
    #[arg(long)]
    pub masks: Option<String>,
    /// Batch size for ONNX inference (number of 256×256 tiles per forward pass)
    #[arg(long, default_value_t = 1)]
    pub batch_size: usize,
    /// Force CPU (skip CUDA)
    #[arg(long)]
    pub cpu: bool,
}

// ---------------------------------------------------------------------------
// Preprocessing helpers (read from zarr)
// ---------------------------------------------------------------------------

/// O(n) median of u16 slice via select_nth_unstable. Uses a copy to avoid mutating input.
fn median_u16(values: &[u16]) -> u16 {
    if values.is_empty() {
        return 0;
    }
    let mut v: Vec<u16> = values.to_vec();
    let mid = v.len() / 2;
    if v.len() % 2 == 1 {
        v.select_nth_unstable(mid);
        v[mid]
    } else {
        v.select_nth_unstable(mid);
        let left_max = v[..mid].iter().max().copied().unwrap();
        ((left_max as u32 + v[mid] as u32) / 2) as u16
    }
}

/// Build (3, H, W) CHW for CellSAM: [phase, fluo, phase], min-max normalised per channel.
fn build_chw_cellsam(mut phase: Vec<f32>, mut fluo: Vec<f32>, h: usize, w: usize) -> Vec<f32> {
    cellsam_rs::preprocess::minmax_normalize(&mut phase);
    cellsam_rs::preprocess::minmax_normalize(&mut fluo);
    let mut out = vec![0.0f32; 3 * h * w];
    out[..h * w].copy_from_slice(&phase);
    out[h * w..2 * h * w].copy_from_slice(&fluo);
    out[2 * h * w..].copy_from_slice(&phase);
    out
}

/// Read a zarr crop as f32 for a given (t, channel): shape (H, W).
fn read_frame_f32(
    crop_arr: &zarr::StoreArray,
    t: u64,
    channel: u64,
    h: usize,
    w: usize,
) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let chunk = zarr::read_chunk_u16(crop_arr, &[t, channel, 0, 0, 0])?;
    let out: Vec<f32> = chunk.iter().map(|&v| v as f32).collect();
    debug_assert_eq!(out.len(), h * w);
    Ok(out)
}

// ---------------------------------------------------------------------------
// Zarr output helpers
// ---------------------------------------------------------------------------

fn ensure_mask_groups(store: &zarr::Store, pos_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    use zarrs::group::GroupBuilder;
    use zarrs::storage::ReadableWritableListableStorageTraits;
    use std::sync::Arc;

    let st: Arc<dyn ReadableWritableListableStorageTraits> = store.clone();
    let root = GroupBuilder::new().build(st.clone(), "/")?;
    root.store_metadata()?;
    let pos = GroupBuilder::new().build(st.clone(), "/pos")?;
    pos.store_metadata()?;
    let pg = GroupBuilder::new().build(st.clone(), &format!("/pos/{}", pos_id))?;
    pg.store_metadata()?;
    let cg = GroupBuilder::new().build(st.clone(), &format!("/pos/{}/crop", pos_id))?;
    cg.store_metadata()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// run_segment
// ---------------------------------------------------------------------------

fn run_segment(
    args: &TissueArgs,
    masks_path: &Path,
    progress: &impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let crops_zarr = Path::new(&args.input);
    let pos_id = format!("{:03}", args.pos);
    let crop_root = crops_zarr.join("pos").join(&pos_id).join("crop");

    if !crop_root.exists() {
        return Err("No crops found. Run crop task first.".into());
    }

    let mut crop_ids: Vec<String> = fs::read_dir(&crop_root)?
        .filter_map(|e| {
            let e = e.ok()?;
            if e.file_type().ok()?.is_dir() { e.file_name().to_str().map(String::from) } else { None }
        })
        .collect();
    crop_ids.sort();

    if crop_ids.is_empty() {
        return Err("No crops found.".into());
    }

    let model_dir = Path::new(&args.model);
    let method = args.method.as_str();

    if method == "cellpose" {
        let model_file = model_dir.join("model.onnx");
        if !model_file.exists() {
            return Err(format!(
                "Cellpose model not found at {}. Export with: python scripts/export_onnx.py",
                model_file.display()
            ).into());
        }
    } else if method == "cellsam" {
        for name in ["image_encoder.onnx", "cellfinder.onnx", "mask_decoder.onnx", "image_pe.npy"] {
            if !model_dir.join(name).exists() {
                return Err(format!(
                    "CellSAM model file not found: {}/{}",
                    model_dir.display(),
                    name
                ).into());
            }
        }
    } else {
        return Err(format!(
            "Unknown method {method:?}. Use 'cellpose' or 'cellsam'."
        ).into());
    }

    let crop_store = zarr::open_store(crops_zarr)?;
    let mask_store = zarr::open_store(masks_path)?;
    ensure_mask_groups(&mask_store, &pos_id)?;

    let mut total_frames = 0u64;
    for crop_id in &crop_ids {
        let arr = zarr::open_array(&crop_store, &format!("/pos/{}/crop/{}", pos_id, crop_id))?;
        total_frames += arr.shape()[0];
    }
    let n_crops = crop_ids.len();

    if method == "cellpose" {
        let mut session = CellposeSession::new(&model_dir.join("model.onnx"), args.cpu)?;
        let mut done = 0u64;
        for (ci, crop_id) in crop_ids.iter().enumerate() {
            let arr = zarr::open_array(&crop_store, &format!("/pos/{}/crop/{}", pos_id, crop_id))?;
            let shape = arr.shape();
            let n_t = shape[0] as usize;
            let h = shape[3] as usize;
            let w = shape[4] as usize;

            let mask_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
            let mut attrs = serde_json::Map::new();
            attrs.insert("axis_names".to_string(), serde_json::json!(["t", "y", "x"]));
            let mask_arr = zarr::create_array_u16(
                &mask_store,
                &mask_path,
                vec![n_t as u64, h as u64, w as u64],
                vec![1, h as u64, w as u64],
                Some(attrs),
            )?;

            for t in 0..n_t {
                let phase = read_frame_f32(&arr, t as u64, args.channel_phase as u64, h, w)?;
                let fluo = read_frame_f32(&arr, t as u64, args.channel_fluorescence as u64, h, w)?;
                let chw = cellpose_rs::preprocess::build_chw_image(phase, fluo, h, w);
                let params = CellposeParams {
                    batch_size: args.batch_size,
                    ..Default::default()
                };
                let masks_u32 = session.segment(&chw, h, w, params)?;
                let masks_u16: Vec<u16> = masks_u32.iter().map(|&v| v as u16).collect();
                zarr::store_chunk_u16(&mask_arr, &[t as u64, 0, 0], &masks_u16)?;
                done += 1;
                progress(
                    done as f64 / total_frames as f64 * 0.5,
                    &format!("Segment crop {}/{}, frame {}/{}", ci + 1, n_crops, t + 1, n_t),
                );
            }
        }
    } else if method == "cellsam" {
        let mut session = CellsamSession::new(model_dir, args.cpu)?;
        let mut done = 0u64;
        for (ci, crop_id) in crop_ids.iter().enumerate() {
            let arr = zarr::open_array(&crop_store, &format!("/pos/{}/crop/{}", pos_id, crop_id))?;
            let shape = arr.shape();
            let n_t = shape[0] as usize;
            let h = shape[3] as usize;
            let w = shape[4] as usize;

            let mask_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
            let mut attrs = serde_json::Map::new();
            attrs.insert("axis_names".to_string(), serde_json::json!(["t", "y", "x"]));
            let mask_arr = zarr::create_array_u16(
                &mask_store,
                &mask_path,
                vec![n_t as u64, h as u64, w as u64],
                vec![1, h as u64, w as u64],
                Some(attrs),
            )?;

            for t in 0..n_t {
                let phase = read_frame_f32(&arr, t as u64, args.channel_phase as u64, h, w)?;
                let fluo = read_frame_f32(&arr, t as u64, args.channel_fluorescence as u64, h, w)?;
                let chw = build_chw_cellsam(phase, fluo, h, w);
                let params = CellsamParams::default();
                let masks_u32 = session.segment(&chw, h, w, params)?;
                let masks_u16: Vec<u16> = masks_u32.iter().map(|&v| v as u16).collect();
                zarr::store_chunk_u16(&mask_arr, &[t as u64, 0, 0], &masks_u16)?;
                done += 1;
                progress(
                    done as f64 / total_frames as f64 * 0.5,
                    &format!("Segment crop {}/{}, frame {}/{}", ci + 1, n_crops, t + 1, n_t),
                );
            }
        }
    } else {
        unreachable!("method validated above");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// run_analyze
// ---------------------------------------------------------------------------

fn run_analyze(
    args: &TissueArgs,
    masks_path: &Path,
    progress: &impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let crops_zarr = Path::new(&args.input);
    let pos_id = format!("{:03}", args.pos);
    let crop_root = crops_zarr.join("pos").join(&pos_id).join("crop");

    let mut crop_ids: Vec<String> = fs::read_dir(&crop_root)?
        .filter_map(|e| {
            let e = e.ok()?;
            if e.file_type().ok()?.is_dir() { e.file_name().to_str().map(String::from) } else { None }
        })
        .collect();
    crop_ids.sort();

    let crop_store = zarr::open_store(crops_zarr)?;
    let mask_store = zarr::open_store(masks_path)?;

    // Load background array if present
    let bg_path = format!("/pos/{}/background", pos_id);
    let mut backgrounds: Vec<u16> = Vec::new();
    if let Ok(bg_arr) = zarr::open_array(&crop_store, &bg_path) {
        let sh = bg_arr.shape();
        if sh.len() >= 2 && (args.channel_fluorescence as u64) < sh[1] {
            for t in 0..sh[0] {
                let chunk_indices = [t, args.channel_fluorescence as u64, 0];
                backgrounds.push(
                    zarr::read_chunk_u16(&bg_arr, &chunk_indices)
                        .ok()
                        .and_then(|d| d.first().copied())
                        .unwrap_or(0),
                );
            }
        }
    }

    let out_path = Path::new(&args.output);
    let mut wtr = fs::File::create(out_path)?;
    writeln!(wtr, "t,crop,cell,total_fluorescence,cell_area,background")?;

    let n_crops = crop_ids.len();
    let mut total_frames = 0u64;
    for crop_id in &crop_ids {
        let arr = zarr::open_array(&crop_store, &format!("/pos/{}/crop/{}", pos_id, crop_id))?;
        total_frames += arr.shape()[0];
    }
    let mut done = 0u64;

    for (ci, crop_id) in crop_ids.iter().enumerate() {
        let arr = zarr::open_array(&crop_store, &format!("/pos/{}/crop/{}", pos_id, crop_id))?;
        let shape = arr.shape();
        let n_t = shape[0] as usize;
        let h = shape[3] as usize;
        let w = shape[4] as usize;

        let mask_arr_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
        let mask_arr = zarr::open_array(&mask_store, &mask_arr_path)?;

        for t in 0..n_t {
            let fluo_raw = zarr::read_chunk_u16(&arr, &[t as u64, args.channel_fluorescence as u64, 0, 0, 0])?;
            let masks = zarr::read_chunk_u16(&mask_arr, &[t as u64, 0, 0])?;

            let max_label = *masks.iter().max().unwrap_or(&0);
            if max_label == 0 {
                done += 1;
                progress(
                    0.5 + done as f64 / total_frames as f64 * 0.5,
                    &format!("Analyze crop {}/{}, frame {}/{}", ci + 1, n_crops, t + 1, n_t),
                );
                continue;
            }

            let mut sums = vec![0.0f64; max_label as usize + 1];
            let mut counts = vec![0u64; max_label as usize + 1];

            for i in 0..h * w {
                let lbl = masks[i] as usize;
                if lbl > 0 {
                    sums[lbl] += fluo_raw[i] as f64;
                    counts[lbl] += 1;
                }
            }

            let bg_val = backgrounds
                .get(t)
                .copied()
                .unwrap_or_else(|| median_u16(&fluo_raw));

            for lbl in 1..=max_label as usize {
                if counts[lbl] > 0 {
                    writeln!(
                        wtr,
                        "{},{},{},{},{},{}",
                        t, crop_id, lbl, sums[lbl], counts[lbl], bg_val
                    )?;
                }
            }

            done += 1;
            progress(
                0.5 + done as f64 / total_frames as f64 * 0.5,
                &format!("Analyze crop {}/{}, frame {}/{}", ci + 1, n_crops, t + 1, n_t),
            );
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// run (entry point)
// ---------------------------------------------------------------------------

pub fn run(
    args: TissueArgs,
    progress: impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let masks_path = match &args.masks {
        Some(p) => std::path::PathBuf::from(p),
        None => {
            let out = Path::new(&args.output);
            out.parent().unwrap_or(Path::new(".")).join("masks.zarr")
        }
    };

    run_segment(&args, &masks_path, &progress)?;
    run_analyze(&args, &masks_path, &progress)?;

    progress(1.0, "Done");
    Ok(())
}

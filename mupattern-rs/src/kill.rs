//! Kill predict: ONNX inference for binary cell presence (absent/present).
//! Expects model dir with model.onnx.
//! Input: NCHW float32 [N, 3, 224, 224], ImageNet normalization.

use clap::Args;
use image::{imageops::FilterType, GrayImage, ImageBuffer, Luma};
use ndarray::{Array, ArrayViewD, Ix4};
#[cfg(any(windows, target_os = "linux"))]
use ort::ep::{ExecutionProvider, CUDA};
use ort::session::Session;
use ort::value::Tensor;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;

use crate::zarr;

const IMAGE_SIZE: u32 = 224;
const IMAGENET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [f32; 3] = [0.229, 0.224, 0.225];

#[derive(Args, Clone)]
pub struct KillArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub model: String,
    #[arg(long)]
    pub output: String,
    #[arg(long, default_value_t = 256)]
    pub batch_size: usize,
    /// Force CPU (skip CUDA). Use if GPU path hangs.
    #[arg(long)]
    pub cpu: bool,
    /// Skip confirmation prompt
    #[arg(long)]
    pub yes: bool,
    /// Show planned kill prediction and exit without writing output
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Debug, Clone)]
pub struct KillPlan {
    pub pos: u32,
    pub model: String,
    pub n_crops: usize,
    pub n_frames: usize,
    pub n_channels: usize,
    pub batch_size: usize,
    pub output: String,
}

struct CropFrame {
    t: u64,
    crop_id: String,
    data: Vec<u16>,
    height: u64,
    width: u64,
}

/// Lightweight index entry: (crop_id, t, height, width) - no pixel data.
struct FrameIndex {
    crop_id: String,
    t: u64,
    height: u64,
    width: u64,
}

pub fn plan(args: &KillArgs) -> Result<KillPlan, Box<dyn std::error::Error>> {
    let crops_zarr = Path::new(&args.input);
    let pos_id = format!("{:03}", args.pos);
    let crop_root = crops_zarr.join("pos").join(&pos_id).join("crop");

    if !crop_root.exists() {
        return Err("No crops found for position. Run crop task first.".into());
    }

    let crop_ids: Vec<String> = fs::read_dir(&crop_root)?
        .filter_map(|e| {
            let e = e.ok()?;
            if e.file_type().ok()?.is_dir() {
                e.file_name().to_str().map(String::from)
            } else {
                None
            }
        })
        .collect();
    let mut crop_ids = crop_ids;
    crop_ids.sort();

    if crop_ids.is_empty() {
        return Err("No crops found for position.".into());
    }

    let model_path = Path::new(&args.model).join("model.onnx");
    if !model_path.exists() {
        return Err(format!(
            "Model not found at {}. Export with: uv run optimum-cli export onnx ...",
            model_path.display()
        )
        .into());
    }

    let store = zarr::open_store(&crops_zarr)?;

    let mut n_channels = 0usize;
    let mut total_frames = 0usize;
    for crop_id in &crop_ids {
        let arr = zarr::open_array(&store, &format!("/pos/{}/crop/{}", pos_id, crop_id))?;
        let shape = arr.shape();
        if shape.len() < 4 {
            continue;
        }
        n_channels = n_channels.max(shape[1] as usize);
        total_frames += shape[0] as usize;
    }

    Ok(KillPlan {
        pos: args.pos,
        model: args.model.clone(),
        n_crops: crop_ids.len(),
        n_frames: total_frames,
        n_channels,
        batch_size: args.batch_size,
        output: args.output.clone(),
    })
}

/// Build ONNX session. Tries CUDA if use_cuda; on CUDA failure falls back to CPU.
fn build_kill_session(
    model_path: &Path,
    _use_cuda: bool,
) -> Result<Session, Box<dyn std::error::Error>> {
    #[cfg(any(windows, target_os = "linux"))]
    if _use_cuda {
        let mut builder = Session::builder()?;
        let cuda = CUDA::default();
        if cuda.is_available().unwrap_or(false) {
            if cuda.register(&mut builder).is_ok() {
                match builder.commit_from_file(model_path) {
                    Ok(s) => {
                        eprintln!("kill: using CUDA for GPU acceleration.");
                        let _ = std::io::stderr().flush();
                        return Ok(s);
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        if msg.to_lowercase().contains("cuda")
                            || msg.contains("no CUDA-capable device")
                        {
                            eprintln!(
                                "kill: CUDA failed ({}), falling back to CPU.",
                                msg.lines().next().unwrap_or(&msg)
                            );
                            let _ = std::io::stderr().flush();
                            // Fall through to CPU path
                        } else {
                            return Err(e.into());
                        }
                    }
                }
            }
        }
    }

    eprintln!("kill: using CPU.");
    let _ = std::io::stderr().flush();
    Ok(Session::builder()?.commit_from_file(model_path)?)
}

/// Min-max normalize uint16 frame to 0-255.
fn normalize_frame(data: &[u16]) -> Vec<u8> {
    if data.is_empty() {
        return vec![];
    }
    let (min, max) = data.iter().fold((data[0], data[0]), |(min, max), &v| {
        (min.min(v), max.max(v))
    });
    let range = (max - min) as f64;
    data.iter()
        .map(|&v| {
            if range > 0.0 {
                (((v - min) as f64 / range) * 255.0).round() as u8
            } else {
                0
            }
        })
        .collect()
}

/// Resize grayscale (H,W) to 224x224.
fn resize_to_224(data: &[u8], width: u32, height: u32) -> GrayImage {
    let img = ImageBuffer::<Luma<u8>, Vec<u8>>::from_raw(width, height, data.to_vec())
        .unwrap_or_else(|| {
            ImageBuffer::from_raw(width, height, vec![0; (width * height) as usize]).unwrap()
        });
    image::imageops::resize(&img, IMAGE_SIZE, IMAGE_SIZE, FilterType::Triangle)
}

/// Convert 224x224 grayscale to NCHW float32 with ImageNet normalization.
fn to_nchw_normalized(gray: &GrayImage) -> Vec<f32> {
    let n = (IMAGE_SIZE * IMAGE_SIZE) as usize;
    let mut out = vec![0.0f32; 3 * n];
    for (i, &v) in gray.as_raw().iter().enumerate() {
        let normalized = v as f32 / 255.0;
        for c in 0..3 {
            out[c * n + i] = (normalized - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
        }
    }
    out
}

pub fn run(args: KillArgs, progress: impl Fn(f64, &str)) -> Result<(), Box<dyn std::error::Error>> {
    eprintln!("kill: starting");
    let _ = std::io::stderr().flush();
    let crops_zarr = Path::new(&args.input);
    let pos_id = format!("{:03}", args.pos);
    let crop_root = crops_zarr.join("pos").join(&pos_id).join("crop");

    if !crop_root.exists() {
        return Err("No crops found for position. Run crop task first.".into());
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
        return Err("No crops found for position.".into());
    }
    eprintln!("kill: loaded {} crop(s), opening zarr...", crop_ids.len());
    let _ = std::io::stderr().flush();

    let store = zarr::open_store(&crops_zarr)?;
    eprintln!("kill: zarr opened, scanning frame index...");
    let _ = std::io::stderr().flush();

    // Build lightweight index (metadata only, no pixel data)
    let mut indices: Vec<FrameIndex> = Vec::new();
    for (i, crop_id) in crop_ids.iter().enumerate() {
        if i > 0 && i % 100 == 0 {
            progress(
                i as f64 / crop_ids.len() as f64 * 0.2,
                &format!("Scanning {}/{} crops", i, crop_ids.len()),
            );
        }
        let array_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
        let arr = zarr::open_array(&store, &array_path)?;
        let shape = arr.shape();
        let n_t = shape[0];
        let h = shape[3];
        let w = shape[4];
        for t in 0..n_t {
            indices.push(FrameIndex {
                crop_id: crop_id.clone(),
                t,
                height: h,
                width: w,
            });
        }
    }

    let total = indices.len();
    eprintln!("kill: {} frames to process, loading model...", total);
    let _ = std::io::stderr().flush();

    if total == 0 {
        fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
        fs::write(&args.output, "t,crop,label\n")?;
        progress(1.0, "No frames to predict, wrote empty CSV.");
        return Ok(());
    }

    let model_path = Path::new(&args.model).join("model.onnx");
    if !model_path.exists() {
        return Err(format!(
            "Model not found at {}. Export with: uv run optimum-cli export onnx --model keejkrej/mupattern-resnet18 {}",
            model_path.display(),
            args.model
        )
        .into());
    }

    let mut session = build_kill_session(&model_path, !args.cpu)?;

    eprintln!("kill: model loaded, running inference...");
    let _ = std::io::stderr().flush();

    let input_name = session
        .inputs()
        .first()
        .ok_or("Model has no inputs")?
        .name()
        .to_string();

    let mut rows: Vec<(u64, String, bool)> = Vec::new();
    let batch_size = args.batch_size;
    let mut array_cache: HashMap<String, zarr::StoreArray> = HashMap::new();

    for (batch_start, index_chunk) in indices.chunks(batch_size).enumerate() {
        // Load only this batch's pixel data
        let mut batch_frames: Vec<CropFrame> = Vec::with_capacity(index_chunk.len());
        for idx in index_chunk {
            let array_path = format!("/pos/{}/crop/{}", pos_id, idx.crop_id);
            if !array_cache.contains_key(&idx.crop_id) {
                let arr = zarr::open_array(&store, &array_path)?;
                array_cache.insert(idx.crop_id.clone(), arr);
            }
            let arr = array_cache.get(&idx.crop_id).unwrap();
            let chunk_indices = vec![idx.t, 0u64, 0, 0, 0];
            let data = zarr::read_chunk_u16(arr, &chunk_indices)?;
            batch_frames.push(CropFrame {
                t: idx.t,
                crop_id: idx.crop_id.clone(),
                data,
                height: idx.height,
                width: idx.width,
            });
        }

        let batch_len = batch_frames.len();
        let mut batch_data =
            vec![0.0f32; batch_len * 3 * IMAGE_SIZE as usize * IMAGE_SIZE as usize];

        for (i, frame) in batch_frames.iter().enumerate() {
            let normalized = normalize_frame(&frame.data);
            let resized = resize_to_224(&normalized, frame.width as u32, frame.height as u32);
            let nchw = to_nchw_normalized(&resized);
            let offset = i * 3 * IMAGE_SIZE as usize * IMAGE_SIZE as usize;
            batch_data[offset..offset + nchw.len()].copy_from_slice(&nchw);
        }

        let shape: Ix4 = ndarray::Dim([
            batch_len as usize,
            3,
            IMAGE_SIZE as usize,
            IMAGE_SIZE as usize,
        ]);
        let arr = Array::from_shape_vec(shape, batch_data)?;
        let input_tensor = Tensor::from_array(arr)?;
        let input = ort::inputs![input_name.as_str() => input_tensor];

        let outputs = session.run(input)?;
        let output = &outputs[0];
        let logits: ArrayViewD<f32> = output.try_extract_array()?;

        // Logits shape: [N, num_classes] (e.g. [batch, 2])
        let ndim = logits.ndim();
        let num_classes = if ndim >= 2 {
            logits.shape()[ndim - 1]
        } else {
            2
        };
        for (i, frame) in batch_frames.iter().enumerate() {
            let mut max_idx = 0;
            let mut max_val = if ndim == 2 {
                logits[[i, 0]]
            } else {
                logits[[i, 0, 0, 0]]
            };
            for c in 1..num_classes {
                let v = if ndim == 2 {
                    logits[[i, c]]
                } else {
                    logits[[i, c, 0, 0]]
                };
                if v > max_val {
                    max_val = v;
                    max_idx = c;
                }
            }
            rows.push((frame.t, frame.crop_id.clone(), max_idx == 1));
        }

        let processed = (batch_start + 1) * batch_size;
        let prog = 0.2 + (processed.min(total) as f64 / total as f64) * 0.8; // 20% for scan, 80% for infer
        progress(
            prog,
            &format!("Predicting {}/{}", processed.min(total), total),
        );
    }

    fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;
    let mut csv = "t,crop,label\n".to_string();
    for (t, crop, label) in &rows {
        csv.push_str(&format!(
            "{},{},{}\n",
            t,
            crop,
            label.to_string().to_lowercase()
        ));
    }
    fs::write(&args.output, csv)?;
    progress(
        1.0,
        &format!("Wrote {} rows to {}", rows.len(), args.output),
    );

    Ok(())
}

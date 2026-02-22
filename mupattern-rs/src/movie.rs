use clap::Args;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::slices;
use crate::zarr;

#[derive(Args, Clone)]
pub struct MovieArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub crop: u32,
    #[arg(long)]
    pub channel: u32,
    #[arg(long)]
    pub time: String,
    #[arg(long)]
    pub output: String,
    #[arg(long, default_value_t = 10)]
    pub fps: u32,
    #[arg(long, default_value = "grayscale")]
    pub colormap: String,
    #[arg(long)]
    pub spots: Option<String>,
    #[arg(long)]
    pub ffmpeg: String,
}

pub fn run(
    args: MovieArgs,
    progress: impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let zarr_path = Path::new(&args.input);
    let crop_id = format!("{:03}", args.crop);
    let pos_id = format!("{:03}", args.pos);

    let store = zarr::open_store(zarr_path)?;
    let array_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
    let arr = zarr::open_array(&store, &array_path)?;
    let shape = arr.shape();
    let n_t = shape[0];
    let n_channels = shape[1];
    if args.channel >= n_channels as u32 {
        return Err(format!("Channel {} out of range (0-{})", args.channel, n_channels - 1).into());
    }
    let h = shape[3];
    let w = shape[4];

    let time_indices = slices::parse_slice_string(&args.time, n_t as usize)?;
    if time_indices.is_empty() {
        return Err("No frames to write".into());
    }

    let mut frames_raw: Vec<Vec<f64>> = Vec::new();
    for (i, &t) in time_indices.iter().enumerate() {
        progress(
            (i + 1) as f64 / time_indices.len() as f64 * 0.4,
            &format!("Reading frames {}/{}", i + 1, time_indices.len()),
        );
        let chunk_indices = vec![t as u64, args.channel as u64, 0, 0, 0];
        let data = zarr::read_chunk_u16(&arr, &chunk_indices)?;
        let f64_frame: Vec<f64> = data.iter().map(|&v| v as f64).collect();
        frames_raw.push(f64_frame);
    }

    let mut global_min = f64::INFINITY;
    let mut global_max = f64::NEG_INFINITY;
    for f in &frames_raw {
        for v in f {
            if *v < global_min {
                global_min = *v;
            }
            if *v > global_max {
                global_max = *v;
            }
        }
    }
    let range = global_max - global_min;

    let colormap = &args.colormap;
    let mut frames_rgb: Vec<Vec<u8>> = Vec::new();
    for frame_raw in &frames_raw {
        let mut rgb = Vec::with_capacity((w * h * 3) as usize);
        for v in frame_raw {
            let norm = if range > 0.0 {
                ((*v - global_min) / range).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let (r, g, b) = apply_colormap(norm, colormap);
            rgb.push(r);
            rgb.push(g);
            rgb.push(b);
        }
        frames_rgb.push(rgb);
    }

    let pad_h = (16 - (h % 16)) % 16;
    let pad_w = (16 - (w % 16)) % 16;
    let (out_w, out_h) = if pad_h > 0 || pad_w > 0 {
        (w + pad_w, h + pad_h)
    } else {
        (w, h)
    };

    let mut padded = Vec::new();
    for rgb in &frames_rgb {
        let mut p = vec![0u8; (out_w * out_h * 3) as usize];
        for y in 0..h {
            for x in 0..w {
                let src = (y * w + x) as usize * 3;
                let dst = (y * out_w + x) as usize * 3;
                p[dst] = rgb[src];
                p[dst + 1] = rgb[src + 1];
                p[dst + 2] = rgb[src + 2];
            }
        }
        padded.push(p);
    }

    std::fs::create_dir_all(Path::new(&args.output).parent().unwrap_or(Path::new(".")))?;

    let mut child = Command::new(&args.ffmpeg)
        .args([
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", &format!("{}x{}", out_w, out_h),
            "-r", &args.fps.to_string(),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "slow",
            "-crf", "15",
            "-y",
            &args.output,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    let mut stdin = child.stdin.take().ok_or("Failed to open ffmpeg stdin")?;
    for (i, frame) in padded.iter().enumerate() {
        stdin.write_all(frame)?;
        progress(
            0.4 + (i + 1) as f64 / padded.len() as f64 * 0.6,
            &format!("Encoding {}/{}", i + 1, padded.len()),
        );
    }
    drop(stdin);
    let status = child.wait()?;
    if !status.success() {
        return Err(format!("ffmpeg exited with code {}", status.code().unwrap_or(-1)).into());
    }

    progress(1.0, &format!("Wrote {}", args.output));
    Ok(())
}

fn apply_colormap(v: f64, colormap: &str) -> (u8, u8, u8) {
    let v = v.clamp(0.0, 1.0);
    match colormap.to_lowercase().as_str() {
        "grayscale" => {
            let u = (v * 255.0).round() as u8;
            (u, u, u)
        }
        "hot" => {
            if v < 1.0 / 3.0 {
                let r = (v * 3.0 * 255.0).round() as u8;
                (r, 0, 0)
            } else if v < 2.0 / 3.0 {
                let g = ((v - 1.0 / 3.0) * 3.0 * 255.0).round() as u8;
                (255, g, 0)
            } else {
                let b = ((v - 2.0 / 3.0) * 3.0 * 255.0).round() as u8;
                (255, 255, b)
            }
        }
        "viridis" => {
            let t = v;
            let r = (0.267 + 0.3244 * t + 2.6477 * t * t - 4.4098 * t * t * t + 2.0942 * t * t * t * t).clamp(0.0, 1.0) * 255.0;
            let g = (0.0046 + 0.0495 * t + 2.5253 * t * t - 6.0613 * t * t * t + 3.7466 * t * t * t * t).clamp(0.0, 1.0) * 255.0;
            let b = (0.3294 + 0.1002 * t + 2.3256 * t * t - 3.1356 * t * t * t + 1.5046 * t * t * t * t).clamp(0.0, 1.0) * 255.0;
            (r.round() as u8, g.round() as u8, b.round() as u8)
        }
        _ => {
            let u = (v * 255.0).round() as u8;
            (u, u, u)
        }
    }
}

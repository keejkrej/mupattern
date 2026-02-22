use clap::Args;
use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::zarr;

#[derive(Args, Clone)]
pub struct CropArgs {
    #[arg(long)]
    pub input: String,
    #[arg(long)]
    pub pos: u32,
    #[arg(long)]
    pub bbox: String,
    #[arg(long)]
    pub output: String,
    #[arg(long, default_value_t = false)]
    pub background: bool,
}

struct Bbox {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

fn parse_bbox_csv(path: &Path) -> Result<Vec<Bbox>, Box<dyn std::error::Error>> {
    let s = fs::read_to_string(path)?;
    let lines: Vec<&str> = s.trim().lines().collect();
    if lines.len() < 2 {
        return Ok(vec![]);
    }
    let header = lines[0].to_lowercase();
    let cols: Vec<&str> = header.split(',').map(|c| c.trim()).collect();
    let crop_idx = cols.iter().position(|c| *c == "crop").ok_or("Missing crop column")?;
    let x_idx = cols.iter().position(|c| *c == "x").ok_or("Missing x column")?;
    let y_idx = cols.iter().position(|c| *c == "y").ok_or("Missing y column")?;
    let w_idx = cols.iter().position(|c| *c == "w").ok_or("Missing w column")?;
    let h_idx = cols.iter().position(|c| *c == "h").ok_or("Missing h column")?;

    let mut out = Vec::new();
    for line in lines.iter().skip(1) {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() <= *[crop_idx, x_idx, y_idx, w_idx, h_idx].iter().max().unwrap() {
            continue;
        }
        out.push(Bbox {
            x: parts[x_idx].trim().parse()?,
            y: parts[y_idx].trim().parse()?,
            w: parts[w_idx].trim().parse()?,
            h: parts[h_idx].trim().parse()?,
        });
    }
    Ok(out)
}

const TIFF_RE: &str = r"^img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif$";

fn discover_tiffs(
    pos_dir: &Path,
    pos: u32,
) -> Result<HashMap<(u32, u32, u32), std::path::PathBuf>, Box<dyn std::error::Error>> {
    let re = Regex::new(TIFF_RE)?;
    let mut index = HashMap::new();
    for entry in fs::read_dir(pos_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let cap = match re.captures(&name) {
            Some(c) => c,
            None => continue,
        };
        let file_pos: u32 = cap[2].parse()?;
        if file_pos != pos {
            continue;
        }
        let c: u32 = cap[1].parse()?;
        let t: u32 = cap[3].parse()?;
        let z: u32 = cap[4].parse()?;
        index.insert((c, t, z), entry.path());
    }
    Ok(index)
}

enum FrameData {
    U16(Vec<u16>),
    U8(Vec<u8>),
}

fn read_tiff_frame(path: &Path) -> Result<(FrameData, u32, u32), Box<dyn std::error::Error>> {
    let file = fs::File::open(path)?;
    let mut decoder = tiff::decoder::Decoder::new(file)?;
    let (width, height) = decoder.dimensions()?;
    let result = decoder.read_image()?;
    let data = match result {
        tiff::decoder::DecodingResult::U8(v) => FrameData::U8(v),
        tiff::decoder::DecodingResult::U16(v) => FrameData::U16(v),
        _ => return Err("Unsupported TIFF pixel format (need u8 or u16)".into()),
    };
    Ok((data, width, height))
}

fn extract_crop_u16(
    frame: &[u16],
    frame_width: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Vec<u16> {
    let mut out = vec![0u16; (w * h) as usize];
    for r in 0..h {
        let src_start = ((y + r) * frame_width + x) as usize;
        let dst_start = (r * w) as usize;
        out[dst_start..dst_start + w as usize]
            .copy_from_slice(&frame[src_start..src_start + w as usize]);
    }
    out
}

fn median_outside_mask_u16(
    frame: &[u16],
    width: u32,
    height: u32,
    mask: &[bool],
) -> u16 {
    let mut values = Vec::new();
    let n = (width * height) as usize;
    for i in 0..n {
        if mask[i] {
            continue;
        }
        values.push(frame[i]);
    }
    median_u16_in_place(&mut values)
}

fn median_outside_mask_u8(frame: &[u8], width: u32, height: u32, mask: &[bool]) -> u16 {
    let mut values = Vec::new();
    let n = (width * height) as usize;
    for i in 0..n {
        if mask[i] {
            continue;
        }
        values.push(frame[i] as u16);
    }
    median_u16_in_place(&mut values)
}

/// O(n) average median via select_nth_unstable. Mutates slice.
fn median_u16_in_place(values: &mut [u16]) -> u16 {
    if values.is_empty() {
        return 0;
    }
    let mid = values.len() / 2;
    if values.len() % 2 == 1 {
        values.select_nth_unstable(mid);
        values[mid]
    } else {
        values.select_nth_unstable(mid);
        let left_max = values[..mid].iter().max().copied().unwrap();
        ((left_max as u32 + values[mid] as u32) / 2) as u16
    }
}

pub fn run(
    args: CropArgs,
    progress: impl Fn(f64, &str),
) -> Result<(), Box<dyn std::error::Error>> {
    let pos_dir = Path::new(&args.input).join(format!("Pos{}", args.pos));
    if !pos_dir.exists() {
        return Err(format!("Position directory not found: {}", pos_dir.display()).into());
    }

    let bboxes = parse_bbox_csv(Path::new(&args.bbox))?;
    if bboxes.is_empty() {
        return Err("No valid bounding boxes in bbox CSV".into());
    }

    let index = discover_tiffs(&pos_dir, args.pos)?;
    if index.is_empty() {
        return Err(format!("No TIFFs found in {}", pos_dir.display()).into());
    }

    let mut keys: Vec<_> = index.keys().copied().collect();
    keys.sort();
    let n_channels = keys.iter().map(|k| k.0).collect::<std::collections::HashSet<_>>().len();
    let n_times = keys.iter().map(|k| k.1).collect::<std::collections::HashSet<_>>().len();
    let n_z = keys.iter().map(|k| k.2).collect::<std::collections::HashSet<_>>().len();
    progress(
        0.0,
        &format!(
            "Discovered {} TIFFs: T={}, C={}, Z={}",
            index.len(),
            n_times,
            n_channels,
            n_z
        ),
    );

    let output_root = Path::new(&args.output);
    let pos_id = format!("{:03}", args.pos);
    let store = zarr::open_store(output_root)?;
    zarr::ensure_pos_crop_groups(&store, &pos_id)?;

    let first_path = index.get(&keys[0]).unwrap();
    let (_first_frame, width, height) = read_tiff_frame(first_path)?;

    let n_times_u = n_times as u64;
    let n_channels_u = n_channels as u64;
    let n_z_u = n_z as u64;

    let mut crop_arrays: Vec<zarr::StoreArray> = Vec::new();
    for (i, bb) in bboxes.iter().enumerate() {
        let crop_id = format!("{:03}", i);
        let array_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
        let shape = vec![n_times_u, n_channels_u, n_z_u, bb.h as u64, bb.w as u64];
        let chunks = vec![1, 1, 1, bb.h as u64, bb.w as u64];
        let attrs = serde_json::json!({
            "axis_names": ["t", "c", "z", "y", "x"],
            "bbox": {"x": bb.x, "y": bb.y, "w": bb.w, "h": bb.h}
        })
        .as_object()
        .cloned();
        let arr = zarr::create_array_u16(&store, &array_path, shape, chunks, attrs)?;
        crop_arrays.push(arr);
    }

    let bg_array: Option<zarr::StoreArray> =
        if args.background {
            let bg_path = format!("/pos/{}/background", pos_id);
            let shape = vec![n_times_u, n_channels_u, n_z_u];
            let chunks = vec![1, 1, 1];
            let attrs = serde_json::json!({
                "axis_names": ["t", "c", "z"],
                "description": "Median of pixels outside all crop bounding boxes"
            })
            .as_object()
            .cloned();
            Some(zarr::create_array_u16(&store, &bg_path, shape, chunks, attrs)?)
        } else {
            None
        };

    let mask: Vec<bool> = if args.background {
        let mut m = vec![false; (width * height) as usize];
        for bb in &bboxes {
            for dy in 0..bb.h {
                for dx in 0..bb.w {
                    let idx = ((bb.y + dy) * width + (bb.x + dx)) as usize;
                    if idx < m.len() {
                        m[idx] = true;
                    }
                }
            }
        }
        m
    } else {
        vec![]
    };

    let total = keys.len();
    for (i, &(c, t, z)) in keys.iter().enumerate() {
        let path = index.get(&(c, t, z)).unwrap();
        let (frame_data, _w, _h) = read_tiff_frame(path)?;

        match &frame_data {
            FrameData::U16(frame) => {
                for (arr, bb) in crop_arrays.iter().zip(bboxes.iter()) {
                    let crop_data = extract_crop_u16(frame, width, bb.x, bb.y, bb.w, bb.h);
                    let chunk_indices = [t as u64, c as u64, z as u64, 0, 0];
                    zarr::store_chunk_u16(arr, &chunk_indices, &crop_data)?;
                }
                if let Some(ref bg) = bg_array {
                    let val = median_outside_mask_u16(frame, width, height, &mask);
                    let chunk_indices = [t as u64, c as u64, z as u64];
                    zarr::store_chunk_u16(bg, &chunk_indices, &[val])?;
                }
            }
            FrameData::U8(frame) => {
                let frame_u16: Vec<u16> = frame.iter().map(|&v| v as u16).collect();
                for (arr, bb) in crop_arrays.iter().zip(bboxes.iter()) {
                    let crop_data = extract_crop_u16(&frame_u16, width, bb.x, bb.y, bb.w, bb.h);
                    let chunk_indices = [t as u64, c as u64, z as u64, 0, 0];
                    zarr::store_chunk_u16(arr, &chunk_indices, &crop_data)?;
                }
                if let Some(ref bg) = bg_array {
                    let val = median_outside_mask_u8(frame, width, height, &mask);
                    let chunk_indices = [t as u64, c as u64, z as u64];
                    zarr::store_chunk_u16(bg, &chunk_indices, &[val])?;
                }
            }
        }

        progress(
            (i + 1) as f64 / total as f64,
            &format!("Reading frames {}/{}", i + 1, total),
        );
    }

    progress(1.0, &format!("Wrote {}", args.output));
    Ok(())
}

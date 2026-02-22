use clap::Args;
use regex::Regex;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use crate::zarr;

#[derive(Args, Clone)]
pub struct CropArgs {
    #[arg(long, help = "Input directory containing Pos{pos} TIFF folders")]
    pub input: String,
    #[arg(long, help = "Position index, used to read Pos{pos}")]
    pub pos: u32,
    #[arg(long, help = "CSV with columns: crop,x,y,w,h")]
    pub bbox: String,
    #[arg(long, help = "Output directory for crops.zarr")]
    pub output: String,
}

struct Bbox {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

const TIFF_RE: &str = r"^img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif$";

fn parse_bbox_csv(path: &Path) -> Result<Vec<Bbox>, Box<dyn std::error::Error>> {
    let s = fs::read_to_string(path)?;
    let mut lines = s.lines();
    let Some(header_line) = lines.next() else {
        return Ok(vec![]);
    };

    let header = header_line.to_lowercase();
    let cols: Vec<&str> = header.split(',').map(|c| c.trim()).collect();

    let crop_idx = cols
        .iter()
        .position(|c| *c == "crop")
        .ok_or("Missing crop column")?;
    let x_idx = cols
        .iter()
        .position(|c| *c == "x")
        .ok_or("Missing x column")?;
    let y_idx = cols
        .iter()
        .position(|c| *c == "y")
        .ok_or("Missing y column")?;
    let w_idx = cols
        .iter()
        .position(|c| *c == "w")
        .ok_or("Missing w column")?;
    let h_idx = cols
        .iter()
        .position(|c| *c == "h")
        .ok_or("Missing h column")?;

    let max_idx = *[crop_idx, x_idx, y_idx, w_idx, h_idx]
        .iter()
        .max()
        .unwrap();

    let mut out = Vec::new();
    for (line_no, line) in lines.enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() <= max_idx {
            return Err(format!(
                "Invalid bbox row {}: expected at least {} columns",
                line_no + 2,
                max_idx + 1
            )
            .into());
        }

        let _crop: u32 = parts[crop_idx]
            .trim()
            .parse()
            .map_err(|_| format!("Invalid crop value at row {}", line_no + 2))?;
        let x: u32 = parts[x_idx]
            .trim()
            .parse()
            .map_err(|_| format!("Invalid x value at row {}", line_no + 2))?;
        let y: u32 = parts[y_idx]
            .trim()
            .parse()
            .map_err(|_| format!("Invalid y value at row {}", line_no + 2))?;
        let w: u32 = parts[w_idx]
            .trim()
            .parse()
            .map_err(|_| format!("Invalid w value at row {}", line_no + 2))?;
        let h: u32 = parts[h_idx]
            .trim()
            .parse()
            .map_err(|_| format!("Invalid h value at row {}", line_no + 2))?;

        out.push(Bbox { x, y, w, h });
    }

    Ok(out)
}

fn discover_tiffs(
    pos_dir: &Path,
    pos: u32,
) -> Result<HashMap<(u32, u32, u32), PathBuf>, Box<dyn std::error::Error>> {
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

        if index.insert((c, t, z), entry.path()).is_some() {
            return Err(format!(
                "Duplicate TIFF tuple found for channel={c}, time={t}, z={z} in {}",
                pos_dir.display()
            )
            .into());
        }
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

fn extract_crop_u16(frame: &[u16], frame_width: u32, x: u32, y: u32, w: u32, h: u32) -> Vec<u16> {
    let mut out = vec![0u16; (w * h) as usize];
    for r in 0..h {
        let src_start = ((y + r) * frame_width + x) as usize;
        let dst_start = (r * w) as usize;
        out[dst_start..dst_start + w as usize]
            .copy_from_slice(&frame[src_start..src_start + w as usize]);
    }
    out
}

fn validate_bboxes(
    bboxes: &[Bbox],
    width: u32,
    height: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    for (i, bb) in bboxes.iter().enumerate() {
        if bb.w == 0 || bb.h == 0 {
            return Err(format!("BBox {} has zero width or height", i).into());
        }
        let x2 = bb
            .x
            .checked_add(bb.w)
            .ok_or_else(|| format!("BBox {} overflows x + w", i))?;
        let y2 = bb
            .y
            .checked_add(bb.h)
            .ok_or_else(|| format!("BBox {} overflows y + h", i))?;
        if x2 > width || y2 > height {
            return Err(format!(
                "BBox {} is out of bounds for frame {}x{}",
                i, width, height
            )
            .into());
        }
    }
    Ok(())
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
        return Err(format!(
            "No TIFFs found in {} matching {}",
            pos_dir.display(),
            TIFF_RE
        )
        .into());
    }

    let mut keys: Vec<_> = index.keys().copied().collect();
    keys.sort_unstable();

    let channels: Vec<u32> = keys
        .iter()
        .map(|k| k.0)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let times: Vec<u32> = keys
        .iter()
        .map(|k| k.1)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let zs: Vec<u32> = keys
        .iter()
        .map(|k| k.2)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let channel_to_idx: HashMap<u32, u64> = channels
        .iter()
        .enumerate()
        .map(|(i, &c)| (c, i as u64))
        .collect();
    let time_to_idx: HashMap<u32, u64> = times
        .iter()
        .enumerate()
        .map(|(i, &t)| (t, i as u64))
        .collect();
    let z_to_idx: HashMap<u32, u64> = zs.iter().enumerate().map(|(i, &z)| (z, i as u64)).collect();

    progress(
        0.0,
        &format!(
            "Discovered {} TIFFs: T={}, C={}, Z={}",
            index.len(),
            times.len(),
            channels.len(),
            zs.len()
        ),
    );

    let output_root = Path::new(&args.output);
    let pos_id = format!("{:03}", args.pos);
    let store = zarr::open_store(output_root)?;
    zarr::ensure_pos_crop_groups(&store, &pos_id)?;

    let first_path = index
        .get(&keys[0])
        .ok_or("Missing first TIFF entry after discovery")?;
    let (_first_frame, width, height) = read_tiff_frame(first_path)?;
    validate_bboxes(&bboxes, width, height)?;

    let n_times_u = times.len() as u64;
    let n_channels_u = channels.len() as u64;
    let n_z_u = zs.len() as u64;

    let mut crop_arrays: Vec<zarr::StoreArray> = Vec::new();
    for (i, bb) in bboxes.iter().enumerate() {
        let crop_id = format!("{:03}", i);
        let array_path = format!("/pos/{pos_id}/crop/{crop_id}");
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

    let total = keys.len();
    for (i, &(c, t, z)) in keys.iter().enumerate() {
        let path = index
            .get(&(c, t, z))
            .ok_or("Missing discovered TIFF while iterating")?;
        let (frame_data, frame_width, frame_height) = read_tiff_frame(path)?;
        if frame_width != width || frame_height != height {
            return Err(format!(
                "Frame dimensions changed at {}: got {}x{}, expected {}x{}",
                path.display(),
                frame_width,
                frame_height,
                width,
                height
            )
            .into());
        }

        let t_idx = *time_to_idx
            .get(&t)
            .ok_or_else(|| format!("Missing time index for {t}"))?;
        let c_idx = *channel_to_idx
            .get(&c)
            .ok_or_else(|| format!("Missing channel index for {c}"))?;
        let z_idx = *z_to_idx
            .get(&z)
            .ok_or_else(|| format!("Missing z index for {z}"))?;
        let chunk_indices = [t_idx, c_idx, z_idx, 0, 0];

        match &frame_data {
            FrameData::U16(frame) => {
                for (arr, bb) in crop_arrays.iter().zip(bboxes.iter()) {
                    let crop_data = extract_crop_u16(frame, width, bb.x, bb.y, bb.w, bb.h);
                    zarr::store_chunk_u16(arr, &chunk_indices, &crop_data)?;
                }
            }
            FrameData::U8(frame) => {
                let frame_u16: Vec<u16> = frame.iter().map(|&v| v as u16).collect();
                for (arr, bb) in crop_arrays.iter().zip(bboxes.iter()) {
                    let crop_data = extract_crop_u16(&frame_u16, width, bb.x, bb.y, bb.w, bb.h);
                    zarr::store_chunk_u16(arr, &chunk_indices, &crop_data)?;
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

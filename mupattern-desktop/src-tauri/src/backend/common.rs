use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tiff::decoder::{Decoder, DecodingResult};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceSnapshot {
    pub workspaces: Vec<serde_json::Value>,
    #[serde(rename = "activeId")]
    pub active_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct TasksState {
    pub tasks: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub ok: bool,
    pub error: String,
}

#[derive(Debug, Serialize)]
pub struct OkResponse {
    pub ok: bool,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum BasicTaskResponse {
    Success(OkResponse),
    Failure(ErrorResponse),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgressPayload {
    pub task_id: String,
    pub progress: f64,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExpressionAnalyzeRow {
    pub t: u32,
    pub crop: String,
    pub intensity: f64,
    pub area: f64,
    pub background: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KillPredictRow {
    pub t: u32,
    pub crop: String,
    pub label: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TissueAnalyzeRow {
    pub t: u32,
    pub crop: String,
    pub cell: u32,
    pub total_fluorescence: f64,
    pub cell_area: u64,
    pub background: f64,
}

pub fn app_state_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app config dir: {e}"))?;
    Ok(dir)
}

pub fn workspace_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_state_dir(app)?.join("workspace-state.json"))
}

pub fn tasks_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_state_dir(app)?.join("tasks-state.json"))
}

static TASKS_STATE_LOCK: once_cell::sync::Lazy<std::sync::Mutex<()>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(()));

pub fn with_tasks_state_lock<T>(f: impl FnOnce() -> T) -> T {
    let _guard = TASKS_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    f()
}

pub fn load_tasks_state(app: &AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = tasks_state_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = fs::read_to_string(path).map_err(|e| format!("failed to read tasks state: {e}"))?;
    let parsed: TasksState =
        serde_json::from_str(&json).map_err(|e| format!("failed to parse tasks state: {e}"))?;
    Ok(parsed.tasks)
}

pub fn save_tasks_state(app: &AppHandle, tasks: &[serde_json::Value]) -> Result<(), String> {
    let path = tasks_state_path(app)?;
    let json = serde_json::to_string_pretty(&TasksState {
        tasks: tasks.to_vec(),
    })
    .map_err(|e| format!("failed to serialize tasks state: {e}"))?;
    fs::write(path, json).map_err(|e| format!("failed to write tasks state: {e}"))?;
    Ok(())
}

pub fn ok_basic() -> BasicTaskResponse {
    BasicTaskResponse::Success(OkResponse { ok: true })
}

pub fn err_basic(error: impl Into<String>) -> BasicTaskResponse {
    BasicTaskResponse::Failure(ErrorResponse {
        ok: false,
        error: error.into(),
    })
}

pub fn emit_task_progress(app: &AppHandle, event: &str, task_id: &str, progress: f64, message: &str) {
    if let Err(err) = app.emit(
        event,
        TaskProgressPayload {
            task_id: task_id.to_string(),
            progress,
            message: message.to_string(),
        },
    ) {
        eprintln!("failed to emit task progress event '{event}': {err}");
    }

    if let Err(err) = with_tasks_state_lock(|| {
        let mut tasks = load_tasks_state(app)?;
        let mut found = false;
        for task in &mut tasks {
            let is_target = task
                .get("id")
                .and_then(|value| value.as_str())
                .map(|id| id == task_id)
                .unwrap_or(false);
            if !is_target {
                continue;
            }
            if let Some(task_obj) = task.as_object_mut() {
                let timestamp = match SystemTime::now().duration_since(UNIX_EPOCH) {
                    Ok(now) => now.as_secs_f64().to_string(),
                    Err(_) => "0".to_string(),
                };
                let entry = serde_json::json!({
                    "progress": progress,
                    "message": message,
                    "timestamp": timestamp,
                });
                match task_obj.get_mut("progress_events") {
                    Some(serde_json::Value::Array(events)) => {
                        events.push(entry);
                    }
                    _ => {
                        task_obj.insert(
                            "progress_events".to_string(),
                            serde_json::Value::Array(vec![entry]),
                        );
                    }
                }
                found = true;
                break;
            }
        }
        if found {
            save_tasks_state(app, &tasks)?;
        }
        Ok::<(), String>(())
    }) {
        eprintln!("failed to persist task progress for {task_id}: {err}");
    }
}

pub fn parse_u32_suffix(segment: &str, prefix: &str) -> Option<u32> {
    if !segment.starts_with(prefix) {
        return None;
    }
    let value = &segment[prefix.len()..];
    if value.is_empty() || !value.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

pub fn parse_position_name(name: &str) -> Option<u32> {
    if let Some(trimmed) = name.strip_prefix("Pos") {
        if !trimmed.is_empty() && trimmed.chars().all(|ch| ch.is_ascii_digit()) {
            return trimmed.parse().ok();
        }
        return None;
    }
    if !name.is_empty() && name.chars().all(|ch| ch.is_ascii_digit()) {
        return name.parse().ok();
    }
    None
}

pub fn sort_numeric_strings(values: &mut [String]) {
    values.sort_by(|a, b| {
        let a_num = a.parse::<u32>().ok();
        let b_num = b.parse::<u32>().ok();
        match (a_num, b_num) {
            (Some(x), Some(y)) => x.cmp(&y).then_with(|| a.cmp(b)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.cmp(b),
        }
    });
}

pub fn scan_tif_metadata(
    path: &Path,
    channels: &mut BTreeSet<u32>,
    times: &mut BTreeSet<u32>,
    z_slices: &mut BTreeSet<u32>,
) {
    let stem = match path.file_stem().and_then(|value| value.to_str()) {
        Some(stem) => stem,
        None => return,
    };
    let ext = match path.extension().and_then(|value| value.to_str()) {
        Some(ext) => ext.to_ascii_lowercase(),
        None => return,
    };
    if ext != "tif" && ext != "tiff" {
        return;
    }

    let mut parts = stem.split('_');
    if parts.next() != Some("img") {
        return;
    }
    for part in parts {
        if part.starts_with("channel") {
            if let Some(v) = parse_u32_suffix(part, "channel") {
                let _ = channels.insert(v);
            }
            continue;
        }
        if part.starts_with("time") {
            if let Some(v) = parse_u32_suffix(part, "time") {
                let _ = times.insert(v);
            }
            continue;
        }
        if part.starts_with("z") {
            if let Some(v) = parse_u32_suffix(part, "z") {
                let _ = z_slices.insert(v);
            }
        }
    }
}

pub fn build_tif_filename(pos: u32, channel: u32, time: u32, z: u32) -> String {
    format!(
        "img_channel{:03}_position{:03}_time{:09}_z{:03}.tif",
        channel, pos, time, z
    )
}

fn normalize_rgba_in_place(rgba: &mut [u8], width: u32, height: u32) {
    let n = (width as usize).saturating_mul(height as usize);
    if n == 0 || rgba.len() < n.saturating_mul(4) {
        return;
    }
    let mut min_lum = f64::INFINITY;
    let mut max_lum = f64::NEG_INFINITY;
    for i in 0..n {
        let j = i * 4;
        let lum = 0.299 * rgba[j] as f64 + 0.587 * rgba[j + 1] as f64 + 0.114 * rgba[j + 2] as f64;
        if lum < min_lum {
            min_lum = lum;
        }
        if lum > max_lum {
            max_lum = lum;
        }
    }
    if max_lum <= min_lum {
        return;
    }
    let scale = 255.0 / (max_lum - min_lum);
    for i in 0..n {
        let j = i * 4;
        let lum = 0.299 * rgba[j] as f64 + 0.587 * rgba[j + 1] as f64 + 0.114 * rgba[j + 2] as f64;
        let new_lum = (lum - min_lum) * scale;
        let factor = if lum > 0.0 { new_lum / lum } else { 0.0 };
        rgba[j] = (rgba[j] as f64 * factor).round().clamp(0.0, 255.0) as u8;
        rgba[j + 1] = (rgba[j + 1] as f64 * factor).round().clamp(0.0, 255.0) as u8;
        rgba[j + 2] = (rgba[j + 2] as f64 * factor).round().clamp(0.0, 255.0) as u8;
    }
}

pub fn read_tiff_rgba(path: &Path) -> Result<(Vec<u8>, u32, u32), String> {
    let file = fs::File::open(path).map_err(|e| format!("failed to open tiff: {e}"))?;
    let mut decoder = Decoder::new(file).map_err(|e| format!("failed to decode tiff: {e}"))?;
    let (width, height) = decoder
        .dimensions()
        .map_err(|e| format!("failed to read dimensions: {e}"))?;
    let n = (width as usize).saturating_mul(height as usize);
    let image = decoder
        .read_image()
        .map_err(|e| format!("failed to read image data: {e}"))?;
    let mut rgba = match image {
        DecodingResult::U8(data) => {
            if data.len() >= n.saturating_mul(3) {
                let mut out = vec![0u8; n.saturating_mul(4)];
                for i in 0..n {
                    let src = i * 3;
                    let dst = i * 4;
                    out[dst] = data[src];
                    out[dst + 1] = data[src + 1];
                    out[dst + 2] = data[src + 2];
                    out[dst + 3] = 255;
                }
                out
            } else if data.len() >= n {
                let mut out = vec![0u8; n.saturating_mul(4)];
                for i in 0..n {
                    let dst = i * 4;
                    let v = data[i];
                    out[dst] = v;
                    out[dst + 1] = v;
                    out[dst + 2] = v;
                    out[dst + 3] = 255;
                }
                out
            } else {
                return Err("unsupported TIFF U8 buffer shape".to_string());
            }
        }
        DecodingResult::U16(data) => {
            if data.len() >= n.saturating_mul(3) {
                let mut out = vec![0u8; n.saturating_mul(4)];
                for i in 0..n {
                    let src = i * 3;
                    let dst = i * 4;
                    out[dst] = (data[src] >> 8) as u8;
                    out[dst + 1] = (data[src + 1] >> 8) as u8;
                    out[dst + 2] = (data[src + 2] >> 8) as u8;
                    out[dst + 3] = 255;
                }
                out
            } else if data.len() >= n {
                let mut out = vec![0u8; n.saturating_mul(4)];
                for i in 0..n {
                    let dst = i * 4;
                    let v = (data[i] >> 8) as u8;
                    out[dst] = v;
                    out[dst + 1] = v;
                    out[dst + 2] = v;
                    out[dst + 3] = 255;
                }
                out
            } else {
                return Err("unsupported TIFF U16 buffer shape".to_string());
            }
        }
        _ => return Err("unsupported TIFF pixel format".to_string()),
    };
    normalize_rgba_in_place(&mut rgba, width, height);
    Ok((rgba, width, height))
}

pub fn parse_expression_csv(path: &Path) -> Result<Vec<ExpressionAnalyzeRow>, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("failed to read expression csv: {e}"))?;
    let mut lines = content.lines();
    let header = lines.next().ok_or("expression csv is empty")?;
    let headers: Vec<&str> = header.split(',').collect();
    let t_idx = headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case("t"))
        .ok_or("missing t column")?;
    let crop_idx = headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case("crop"))
        .ok_or("missing crop column")?;
    let intensity_idx = headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case("intensity"))
        .ok_or("missing intensity column")?;
    let area_idx = headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case("area"))
        .ok_or("missing area column")?;
    let bg_idx = headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case("background"))
        .ok_or("missing background column")?;
    let max_idx = [t_idx, crop_idx, intensity_idx, area_idx, bg_idx]
        .iter()
        .copied()
        .max()
        .unwrap_or(0);

    let mut rows = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() <= max_idx {
            continue;
        }
        let t = match parts[t_idx].trim().parse::<u32>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let crop = parts[crop_idx].trim().to_string();
        let intensity = match parts[intensity_idx].trim().parse::<f64>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let area = match parts[area_idx].trim().parse::<f64>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let background = match parts[bg_idx].trim().parse::<f64>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        rows.push(ExpressionAnalyzeRow {
            t,
            crop,
            intensity,
            area,
            background,
        });
    }
    Ok(rows)
}

pub fn parse_kill_csv(path: &Path) -> Result<Vec<KillPredictRow>, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("failed to read kill csv: {e}"))?;
    let mut lines = content.lines();
    let header = lines.next().ok_or("kill csv is empty")?;
    let headers: Vec<&str> = header.split(',').collect();
    let t_idx = headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case("t"))
        .ok_or("missing t column")?;
    let crop_idx = headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case("crop"))
        .ok_or("missing crop column")?;
    let label_idx = headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case("label"))
        .ok_or("missing label column")?;
    let max_idx = [t_idx, crop_idx, label_idx]
        .iter()
        .copied()
        .max()
        .unwrap_or(0);

    let mut rows = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() <= max_idx {
            continue;
        }
        let t = match parts[t_idx].trim().parse::<u32>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let crop = parts[crop_idx].trim().to_string();
        let label_text = parts[label_idx].trim().to_ascii_lowercase();
        let label = label_text == "true" || label_text == "1";
        rows.push(KillPredictRow { t, crop, label });
    }
    Ok(rows)
}

pub fn parse_tissue_csv(path: &Path) -> Result<Vec<TissueAnalyzeRow>, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("failed to read tissue csv: {e}"))?;
    let mut lines = content.lines();
    let _ = lines.next();
    let mut rows = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() < 6 {
            continue;
        }
        let t = match parts[0].trim().parse::<u32>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let crop = parts[1].trim().to_string();
        let cell = match parts[2].trim().parse::<u32>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let total_fluorescence = match parts[3].trim().parse::<f64>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let cell_area = match parts[4].trim().parse::<u64>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        let background = match parts[5].trim().parse::<f64>() {
            Ok(v) => v,
            Err(_) => continue,
        };
        rows.push(TissueAnalyzeRow {
            t,
            crop,
            cell,
            total_fluorescence,
            cell_area,
            background,
        });
    }
    Ok(rows)
}

pub fn find_ffmpeg() -> Option<String> {
    if ffmpeg_sidecar::command::ffmpeg_is_installed() {
        return Some(ffmpeg_sidecar::paths::ffmpeg_path().to_string_lossy().to_string());
    }

    if let Err(err) = ffmpeg_sidecar::download::auto_download() {
        eprintln!("failed to auto-download ffmpeg sidecar: {err}");
    } else if ffmpeg_sidecar::command::ffmpeg_is_installed() {
        return Some(ffmpeg_sidecar::paths::ffmpeg_path().to_string_lossy().to_string());
    }

    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let path_candidates: Vec<PathBuf> = env::var("PATH")
        .ok()
        .map(|value| env::split_paths(&value).collect())
        .unwrap_or_default();

    let extra_candidates: &[&str] = if cfg!(target_os = "macos") {
        &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
    } else if cfg!(target_os = "linux") {
        &["/usr/local/bin", "/usr/bin", "/bin"]
    } else {
        &[]
    };
    let candidates: Vec<PathBuf> = path_candidates
        .into_iter()
        .chain(extra_candidates.iter().map(|path| PathBuf::from(*path)))
        .collect();

    for dir in candidates {
        let candidate = dir.join(exe);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

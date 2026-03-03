use crate::backend::common::{
    build_tif_filename, parse_position_name, read_tiff_rgba, scan_tif_metadata, workspace_state_path,
    WorkspaceSnapshot,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRescanResult {
    path: String,
    name: String,
    positions: Vec<u32>,
    channels: Vec<u32>,
    times: Vec<u32>,
    z_slices: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReadPositionImageRequest {
    workspace_path: String,
    pos: u32,
    channel: u32,
    time: u32,
    z: u32,
}

#[derive(Debug, Deserialize)]
pub struct WorkspaceSaveBboxCsvRequest {
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    pos: u32,
    csv: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadPositionImageSuccess {
    ok: bool,
    base_name: String,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    ok: bool,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ReadPositionImageResponse {
    Success(ReadPositionImageSuccess),
    Failure(ErrorResponse),
}

#[tauri::command]
pub fn workspace_state_load(app: tauri::AppHandle) -> Result<Option<WorkspaceSnapshot>, String> {
    let path = workspace_state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let json =
        fs::read_to_string(path).map_err(|e| format!("failed to read workspace state: {e}"))?;
    let parsed =
        serde_json::from_str(&json).map_err(|e| format!("failed to parse workspace state: {e}"))?;
    Ok(Some(parsed))
}

#[tauri::command]
pub fn workspace_state_save(
    app: tauri::AppHandle,
    state: WorkspaceSnapshot,
) -> Result<bool, String> {
    let path = workspace_state_path(&app)?;
    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("failed to serialize workspace state: {e}"))?;
    fs::write(path, json).map_err(|e| format!("failed to write workspace state: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn pick_directory(app: AppHandle) -> Option<String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Select workspace folder")
        .blocking_pick_folder();
    selected.map(|path| path.to_string())
}

#[tauri::command]
pub fn workspace_path_exists(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn workspace_rescan_directory(path: String) -> Option<WorkspaceRescanResult> {
    let root = Path::new(&path);
    if !root.exists() || !root.is_dir() {
        return None;
    }

    let mut positions = BTreeSet::<u32>::new();
    let mut channels = BTreeSet::<u32>::new();
    let mut times = BTreeSet::<u32>::new();
    let mut z_slices = BTreeSet::<u32>::new();

    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let is_pos_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let name = entry.file_name().to_string_lossy().to_string();
            let maybe_pos = parse_position_name(&name);
            if !is_pos_dir || maybe_pos.is_none() {
                continue;
            }
            let pos = maybe_pos.unwrap_or(0);
            let _ = positions.insert(pos);
            if let Ok(pos_entries) = fs::read_dir(entry.path()) {
                for file in pos_entries.flatten() {
                    if file.path().is_file() {
                        scan_tif_metadata(&file.path(), &mut channels, &mut times, &mut z_slices);
                    }
                }
            }
        }
    }

    if positions.is_empty() {
        let crops_pos = root.join("pos");
        if let Ok(entries) = fs::read_dir(crops_pos) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                if let Some(pos) = parse_position_name(&entry.file_name().to_string_lossy()) {
                    let _ = positions.insert(pos);
                }
            }
        }
    }

    Some(WorkspaceRescanResult {
        path: path.clone(),
        name: root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string(),
        positions: positions.into_iter().collect(),
        channels: channels.into_iter().collect(),
        times: times.into_iter().collect(),
        z_slices: z_slices.into_iter().collect(),
    })
}

#[tauri::command]
pub fn workspace_pick_tags_file(app: AppHandle) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select tags YAML file")
        .blocking_pick_file()?;
    let path = PathBuf::from(picked.to_string());
    fs::read_to_string(path).ok()
}

#[tauri::command]
pub fn workspace_save_bbox_csv(payload: WorkspaceSaveBboxCsvRequest) -> Result<bool, String> {
    let file_path = Path::new(&payload.workspace_path).join(format!("Pos{}_bbox.csv", payload.pos));
    fs::write(file_path, payload.csv).map_err(|e| format!("failed to write bbox csv: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub fn workspace_read_position_image(
    request: WorkspaceReadPositionImageRequest,
) -> ReadPositionImageResponse {
    let filename = build_tif_filename(request.pos, request.channel, request.time, request.z);
    let file_path = Path::new(&request.workspace_path)
        .join(format!("Pos{}", request.pos))
        .join(&filename);
    match read_tiff_rgba(&file_path) {
        Ok((rgba, width, height)) => ReadPositionImageResponse::Success(ReadPositionImageSuccess {
            ok: true,
            base_name: file_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("image")
                .to_string(),
            width,
            height,
            rgba,
        }),
        Err(error) => ReadPositionImageResponse::Failure(ErrorResponse { ok: false, error }),
    }
}

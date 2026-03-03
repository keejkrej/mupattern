use crate::backend::common::sort_numeric_strings;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZarrDiscoverRequest {
    workspace_path: String,
    position_filter: Option<Vec<String>>,
    metadata_mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZarrDiscoverResponse {
    positions: Vec<String>,
    crops: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZarrLoadFrameRequest {
    workspace_path: String,
    pos_id: String,
    crop_id: String,
    t: u32,
    c: u32,
    z: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZarrLoadFrameSuccess {
    ok: bool,
    width: u32,
    height: u32,
    data: Vec<u16>,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    ok: bool,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ZarrLoadFrameResponse {
    Success(ZarrLoadFrameSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZarrHasMasksRequest {
    masks_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZarrHasMasksResponse {
    has_masks: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZarrLoadMaskFrameRequest {
    masks_path: String,
    pos_id: String,
    crop_id: String,
    t: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZarrLoadMaskFrameSuccess {
    ok: bool,
    width: u32,
    height: u32,
    data: Vec<u32>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ZarrLoadMaskFrameResponse {
    Success(ZarrLoadMaskFrameSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Serialize)]
pub struct PickPathResult {
    path: String,
}

fn resolve_pos_ids(pos_root: &Path, filter: Option<&[String]>) -> Vec<String> {
    let mut all_dir_names: Vec<String> = fs::read_dir(pos_root)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    sort_numeric_strings(&mut all_dir_names);

    let Some(filter_values) = filter else {
        return all_dir_names;
    };

    let mut out = Vec::<String>::new();
    for wanted in filter_values {
        if all_dir_names.contains(wanted) && !out.contains(wanted) {
            out.push(wanted.clone());
            continue;
        }
        if let Ok(wanted_num) = wanted.parse::<u32>() {
            for existing in &all_dir_names {
                if existing.parse::<u32>().ok() == Some(wanted_num) && !out.contains(existing) {
                    out.push(existing.clone());
                }
            }
        }
    }
    sort_numeric_strings(&mut out);
    out
}

#[tauri::command]
pub fn zarr_discover(request: ZarrDiscoverRequest) -> ZarrDiscoverResponse {
    let mut response = ZarrDiscoverResponse {
        positions: vec![],
        crops: serde_json::Map::new(),
    };

    let zarr_path = Path::new(&request.workspace_path).join("crops.zarr");
    let pos_root = zarr_path.join("pos");
    if !pos_root.exists() {
        return response;
    }

    let pos_ids = resolve_pos_ids(&pos_root, request.position_filter.as_deref());
    let store = match mupattern_rs::zarr::open_store(&zarr_path) {
        Ok(store) => store,
        Err(_) => return response,
    };

    let metadata_mode = request
        .metadata_mode
        .as_deref()
        .unwrap_or("full")
        .to_ascii_lowercase();

    for pos_id in pos_ids {
        let crop_root = pos_root.join(&pos_id).join("crop");
        if !crop_root.exists() {
            continue;
        }

        let mut crop_ids: Vec<String> = fs::read_dir(&crop_root)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.flatten())
            .filter(|entry| entry.path().is_dir())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        sort_numeric_strings(&mut crop_ids);

        let mut info = Vec::<serde_json::Value>::new();
        for crop_id in crop_ids {
            let shape = if metadata_mode == "fast" {
                let meta_path = crop_root.join(&crop_id).join("zarr.json");
                fs::read_to_string(meta_path)
                    .ok()
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
                    .and_then(|json| json.get("shape").cloned())
                    .and_then(|value| value.as_array().cloned())
                    .map(|arr| arr.into_iter().filter_map(|v| v.as_u64()).collect::<Vec<u64>>())
                    .unwrap_or_default()
            } else {
                let array_path = format!("/pos/{}/crop/{}", pos_id, crop_id);
                match mupattern_rs::zarr::open_array(&store, &array_path) {
                    Ok(arr) => arr.shape().to_vec(),
                    Err(_) => vec![],
                }
            };

            info.push(serde_json::json!({
                "posId": pos_id,
                "cropId": crop_id,
                "shape": shape
            }));
        }

        if !info.is_empty() {
            response.positions.push(pos_id.clone());
            response.crops.insert(pos_id, serde_json::Value::Array(info));
        }
    }

    sort_numeric_strings(&mut response.positions);
    response
}

#[tauri::command]
pub fn zarr_load_frame(request: ZarrLoadFrameRequest) -> ZarrLoadFrameResponse {
    let zarr_path = Path::new(&request.workspace_path).join("crops.zarr");
    let store = match mupattern_rs::zarr::open_store(&zarr_path) {
        Ok(store) => store,
        Err(err) => {
            return ZarrLoadFrameResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            })
        }
    };

    let array_path = format!("/pos/{}/crop/{}", request.pos_id, request.crop_id);
    let arr = match mupattern_rs::zarr::open_array(&store, &array_path) {
        Ok(arr) => arr,
        Err(err) => {
            return ZarrLoadFrameResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            })
        }
    };

    let shape = arr.shape().to_vec();
    if shape.len() < 5 {
        return ZarrLoadFrameResponse::Failure(ErrorResponse {
            ok: false,
            error: "invalid crop array shape".to_string(),
        });
    }

    let chunk_indices = [request.t as u64, request.c as u64, request.z as u64, 0, 0];
    let data = match mupattern_rs::zarr::read_chunk_u16(&arr, &chunk_indices) {
        Ok(data) => data,
        Err(err) => {
            return ZarrLoadFrameResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            })
        }
    };

    ZarrLoadFrameResponse::Success(ZarrLoadFrameSuccess {
        ok: true,
        width: shape[4] as u32,
        height: shape[3] as u32,
        data,
    })
}

#[tauri::command]
pub fn zarr_has_masks(request: ZarrHasMasksRequest) -> ZarrHasMasksResponse {
    let root = Path::new(&request.masks_path);
    let has_masks = root.is_dir() && root.join("pos").is_dir();
    ZarrHasMasksResponse { has_masks }
}

#[tauri::command]
pub fn zarr_load_mask_frame(request: ZarrLoadMaskFrameRequest) -> ZarrLoadMaskFrameResponse {
    let store = match mupattern_rs::zarr::open_store(Path::new(&request.masks_path)) {
        Ok(store) => store,
        Err(err) => {
            return ZarrLoadMaskFrameResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            })
        }
    };
    let array_path = format!("/pos/{}/crop/{}", request.pos_id, request.crop_id);
    let arr = match mupattern_rs::zarr::open_array(&store, &array_path) {
        Ok(arr) => arr,
        Err(err) => {
            return ZarrLoadMaskFrameResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            })
        }
    };
    let shape = arr.shape().to_vec();
    if shape.len() < 3 {
        return ZarrLoadMaskFrameResponse::Failure(ErrorResponse {
            ok: false,
            error: "invalid mask array shape".to_string(),
        });
    }
    let chunk_indices = [request.t as u64, 0, 0];
    let data_u16 = match mupattern_rs::zarr::read_chunk_u16(&arr, &chunk_indices) {
        Ok(data) => data,
        Err(err) => {
            return ZarrLoadMaskFrameResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            })
        }
    };
    let data = data_u16.into_iter().map(|value| value as u32).collect();
    ZarrLoadMaskFrameResponse::Success(ZarrLoadMaskFrameSuccess {
        ok: true,
        width: shape[2] as u32,
        height: shape[1] as u32,
        data,
    })
}

#[tauri::command]
pub fn zarr_pick_masks_dir(app: tauri::AppHandle) -> Option<PickPathResult> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select masks zarr folder")
        .blocking_pick_folder()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

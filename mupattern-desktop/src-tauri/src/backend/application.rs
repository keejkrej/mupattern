use crate::backend::common::{
    parse_expression_csv, parse_kill_csv, parse_tissue_csv, ErrorResponse, ExpressionAnalyzeRow,
    KillPredictRow, TissueAnalyzeRow,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Debug, Deserialize)]
pub struct WorkspacePathRequest {
    #[serde(rename = "workspacePath")]
    workspace_path: String,
}

#[derive(Debug, Deserialize)]
pub struct CsvPathRequest {
    #[serde(rename = "csvPath")]
    csv_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationExpressionLoadSuccess {
    ok: bool,
    rows: Vec<ExpressionAnalyzeRow>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ApplicationExpressionLoadResponse {
    Success(ApplicationExpressionLoadSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationKillLoadSuccess {
    ok: bool,
    rows: Vec<KillPredictRow>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ApplicationKillLoadResponse {
    Success(ApplicationKillLoadSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationTissueLoadSuccess {
    ok: bool,
    rows: Vec<TissueAnalyzeRow>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ApplicationTissueLoadResponse {
    Success(ApplicationTissueLoadSuccess),
    Failure(ErrorResponse),
}

fn list_csv_files(workspace_path: &str, regex: &Regex) -> Result<Vec<serde_json::Value>, String> {
    let mut out = Vec::<serde_json::Value>::new();
    let entries =
        fs::read_dir(workspace_path).map_err(|e| format!("failed to read workspace directory: {e}"))?;

    for entry in entries.flatten() {
        if !entry.path().is_file() {
            continue;
        }
        let name = match entry.file_name().into_string() {
            Ok(name) => name,
            Err(_) => continue,
        };
        let Some(caps) = regex.captures(&name) else {
            continue;
        };
        let pos_id = caps
            .get(1)
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| {
                Path::new(&name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string()
            });
        out.push(serde_json::json!({
            "posId": pos_id,
            "path": entry.path().to_string_lossy().to_string(),
        }));
    }

    out.sort_by(|a, b| {
        let a_id = a.get("posId").and_then(|v| v.as_str()).unwrap_or("");
        let b_id = b.get("posId").and_then(|v| v.as_str()).unwrap_or("");
        let a_num = a_id.parse::<u32>().ok();
        let b_num = b_id.parse::<u32>().ok();
        match (a_num, b_num) {
            (Some(x), Some(y)) => x.cmp(&y),
            _ => a_id.cmp(b_id),
        }
    });
    Ok(out)
}

#[tauri::command]
pub fn application_list_expression_csv(
    payload: WorkspacePathRequest,
) -> Result<Vec<serde_json::Value>, String> {
    let regex = Regex::new(r"^Pos(\d+)_expression\.csv$")
        .map_err(|e| format!("invalid expression csv regex: {e}"))?;
    list_csv_files(&payload.workspace_path, &regex)
}

#[tauri::command]
pub fn application_load_expression_csv(payload: CsvPathRequest) -> ApplicationExpressionLoadResponse {
    match parse_expression_csv(Path::new(&payload.csv_path)) {
        Ok(rows) => {
            ApplicationExpressionLoadResponse::Success(ApplicationExpressionLoadSuccess { ok: true, rows })
        }
        Err(error) => ApplicationExpressionLoadResponse::Failure(ErrorResponse { ok: false, error }),
    }
}

#[tauri::command]
pub fn application_list_kill_csv(
    payload: WorkspacePathRequest,
) -> Result<Vec<serde_json::Value>, String> {
    let regex = Regex::new(r"^(?:Pos(\d+)_)?(?:prediction|predictions).*\.csv$")
        .map_err(|e| format!("invalid kill csv regex: {e}"))?;
    list_csv_files(&payload.workspace_path, &regex)
}

#[tauri::command]
pub fn application_load_kill_csv(payload: CsvPathRequest) -> ApplicationKillLoadResponse {
    match parse_kill_csv(Path::new(&payload.csv_path)) {
        Ok(rows) => ApplicationKillLoadResponse::Success(ApplicationKillLoadSuccess { ok: true, rows }),
        Err(error) => ApplicationKillLoadResponse::Failure(ErrorResponse { ok: false, error }),
    }
}

#[tauri::command]
pub fn application_list_tissue_csv(
    payload: WorkspacePathRequest,
) -> Result<Vec<serde_json::Value>, String> {
    let regex = Regex::new(r"^Pos(\d+)_tissue\.csv$")
        .map_err(|e| format!("invalid tissue csv regex: {e}"))?;
    list_csv_files(&payload.workspace_path, &regex)
}

#[tauri::command]
pub fn application_load_tissue_csv(payload: CsvPathRequest) -> ApplicationTissueLoadResponse {
    match parse_tissue_csv(Path::new(&payload.csv_path)) {
        Ok(rows) => {
            ApplicationTissueLoadResponse::Success(ApplicationTissueLoadSuccess { ok: true, rows })
        }
        Err(error) => ApplicationTissueLoadResponse::Failure(ErrorResponse { ok: false, error }),
    }
}

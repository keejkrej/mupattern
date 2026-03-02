use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{Emitter, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WorkspaceSnapshot {
    workspaces: Vec<serde_json::Value>,
    #[serde(rename = "activeId")]
    active_id: Option<String>,
}

fn workspace_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app config dir: {e}"))?;
    Ok(dir.join("workspace-state.json"))
}

#[tauri::command]
fn workspace_state_load(app: tauri::AppHandle) -> Result<Option<WorkspaceSnapshot>, String> {
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
fn workspace_state_save(app: tauri::AppHandle, state: WorkspaceSnapshot) -> Result<bool, String> {
    let path = workspace_state_path(&app)?;
    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("failed to serialize workspace state: {e}"))?;
    fs::write(path, json).map_err(|e| format!("failed to write workspace state: {e}"))?;
    Ok(true)
}

#[derive(Debug, Deserialize)]
struct RunConvertRequest {
    input: String,
    output: String,
    pos: String,
    time: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "ok", rename_all = "lowercase")]
enum TaskResult {
    True,
    False { error: String },
}

#[tauri::command]
fn tasks_run_convert(app: tauri::AppHandle, payload: RunConvertRequest) -> TaskResult {
    let emit = |progress: f64, message: &str| {
        let _ = app.emit(
            "tasks:convert-progress",
            serde_json::json!({"progress": progress, "message": message}),
        );
    };

    let args = mupattern_rs::convert::ConvertArgs {
        input: payload.input,
        output: payload.output,
        pos: payload.pos,
        time: payload.time,
        yes: true,
    };

    match mupattern_rs::convert::run(args, emit) {
        Ok(()) => TaskResult::True,
        Err(err) => TaskResult::False {
            error: err.to_string(),
        },
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            workspace_state_load,
            workspace_state_save,
            tasks_run_convert,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

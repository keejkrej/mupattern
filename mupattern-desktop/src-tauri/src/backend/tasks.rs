use crate::backend::common::{
    emit_task_progress, err_basic, find_ffmpeg, load_tasks_state, ok_basic, parse_expression_csv,
    parse_kill_csv, parse_tissue_csv, save_tasks_state, with_tasks_state_lock, BasicTaskResponse,
    ErrorResponse,
};
use crate::backend::common::{ExpressionAnalyzeRow, KillPredictRow, TissueAnalyzeRow};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Deserialize)]
pub struct HasBboxCsvRequest {
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    pos: u32,
}

#[derive(Debug, Deserialize)]
pub struct RunConvertRequest {
    #[serde(rename = "taskId")]
    task_id: String,
    input: String,
    output: String,
    pos: String,
    time: String,
}

#[derive(Debug, Deserialize)]
pub struct RunConvertPlanRequest {
    input: String,
    output: String,
    pos: String,
    time: String,
}

#[derive(Debug, Deserialize)]
pub struct RunCropRequest {
    #[serde(rename = "taskId")]
    task_id: String,
    input_dir: String,
    pos: u32,
    bbox: String,
    output: String,
    background: bool,
}

#[derive(Debug, Deserialize)]
pub struct RunCropPlanRequest {
    input_dir: String,
    pos: u32,
    bbox: String,
    output: String,
    background: bool,
}

#[derive(Debug, Deserialize)]
pub struct RunExpressionAnalyzeRequest {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    pos: u32,
    channel: u32,
    output: String,
}

#[derive(Debug, Deserialize)]
pub struct RunExpressionAnalyzePlanRequest {
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    pos: u32,
    channel: u32,
    output: String,
}

#[derive(Debug, Deserialize)]
pub struct RunKillPredictRequest {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    pos: u32,
    #[serde(rename = "modelPath")]
    model_path: String,
    output: String,
    #[serde(rename = "batchSize")]
    batch_size: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct RunKillPredictPlanRequest {
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    pos: u32,
    #[serde(rename = "modelPath")]
    model_path: String,
    output: String,
    #[serde(rename = "batchSize")]
    batch_size: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct RunTissueAnalyzeRequest {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    pos: u32,
    #[serde(rename = "channelPhase")]
    channel_phase: u32,
    #[serde(rename = "channelFluorescence")]
    channel_fluorescence: u32,
    method: String,
    model: String,
    output: String,
}

#[derive(Debug, Deserialize)]
pub struct RunTissueAnalyzePlanRequest {
    #[serde(rename = "workspacePath")]
    workspace_path: String,
    pos: u32,
    #[serde(rename = "channelPhase")]
    channel_phase: u32,
    #[serde(rename = "channelFluorescence")]
    channel_fluorescence: u32,
    method: String,
    model: String,
    output: String,
}

#[derive(Debug, Deserialize)]
pub struct RunMovieRequest {
    #[serde(rename = "taskId")]
    task_id: String,
    input_zarr: String,
    pos: u32,
    crop: u32,
    channel: u32,
    time: String,
    output: String,
    fps: u32,
    colormap: String,
    spots: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RunMoviePlanRequest {
    input_zarr: String,
    pos: u32,
    crop: u32,
    channel: u32,
    time: String,
    output: String,
    fps: u32,
    colormap: String,
    spots: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExpressionAnalyzeSuccess {
    ok: bool,
    output: String,
    rows: Vec<ExpressionAnalyzeRow>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RunExpressionAnalyzeResponse {
    Success(RunExpressionAnalyzeSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunKillPredictSuccess {
    ok: bool,
    output: String,
    rows: Vec<KillPredictRow>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RunKillPredictResponse {
    Success(RunKillPredictSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTissueAnalyzeSuccess {
    ok: bool,
    output: String,
    rows: Vec<TissueAnalyzeRow>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RunTissueAnalyzeResponse {
    Success(RunTissueAnalyzeSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertPlanSuccess {
    ok: bool,
    output: String,
    n_pos: usize,
    n_time: usize,
    n_chan: usize,
    n_z: usize,
    selected_positions: usize,
    selected_timepoints: usize,
    total_frames: usize,
    positions: Vec<usize>,
    time_indices: Vec<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericPlanSuccess {
    ok: bool,
    task: String,
    output: String,
    summary: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum GenericPlanResponse {
    Success(GenericPlanSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RunConvertPlanResponse {
    Success(ConvertPlanSuccess),
    Failure(ErrorResponse),
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskRequest {
    id: String,
    updates: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct PickPathResult {
    path: String,
}

#[derive(Debug, Deserialize)]
pub struct SuggestedPathPayload {
    #[serde(rename = "suggestedPath")]
    suggested_path: Option<String>,
}

fn update_task_outcome(
    app: &tauri::AppHandle,
    task_id: &str,
    status: &str,
    error: Option<String>,
    result: Option<serde_json::Value>,
) -> Result<(), String> {
    with_tasks_state_lock(|| {
        let mut tasks = load_tasks_state(app)?;
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
                task_obj.insert("status".to_string(), serde_json::Value::String(status.to_string()));
                task_obj.insert(
                    "error".to_string(),
                    match error.clone() {
                        Some(value) => serde_json::Value::String(value),
                        None => serde_json::Value::Null,
                    },
                );
                if let Some(result_value) = result.clone() {
                    task_obj.insert("result".to_string(), result_value);
                }
            }
            break;
        }
        save_tasks_state(app, &tasks)
    })
}

#[tauri::command]
pub fn tasks_pick_nd2_input(app: tauri::AppHandle) -> Option<PickPathResult> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select ND2 file")
        .blocking_pick_file()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

#[tauri::command]
pub fn tasks_pick_crops_destination(app: tauri::AppHandle) -> Option<PickPathResult> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select folder for crops.zarr")
        .blocking_pick_folder()?;
    let path = PathBuf::from(picked.to_string()).join("crops.zarr");
    Some(PickPathResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn tasks_pick_convert_output(app: tauri::AppHandle) -> Option<PickPathResult> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select output folder for TIFFs")
        .blocking_pick_folder()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

#[tauri::command]
pub fn tasks_pick_expression_output(
    app: tauri::AppHandle,
    payload: SuggestedPathPayload,
) -> Option<PickPathResult> {
    let mut builder = app.dialog().file().set_title("Save expression CSV");
    if let Some(path) = payload.suggested_path {
        builder = builder.set_file_name(&path);
    }
    let picked = builder.blocking_save_file()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

#[tauri::command]
pub fn tasks_pick_tissue_output(
    app: tauri::AppHandle,
    payload: SuggestedPathPayload,
) -> Option<PickPathResult> {
    let mut builder = app.dialog().file().set_title("Save tissue CSV");
    if let Some(path) = payload.suggested_path {
        builder = builder.set_file_name(&path);
    }
    let picked = builder.blocking_save_file()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

#[tauri::command]
pub fn tasks_pick_tissue_model(app: tauri::AppHandle) -> Option<PickPathResult> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select tissue model directory")
        .blocking_pick_folder()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

#[tauri::command]
pub fn tasks_pick_kill_model(app: tauri::AppHandle) -> Option<PickPathResult> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select ONNX model directory")
        .blocking_pick_folder()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

#[tauri::command]
pub fn tasks_pick_movie_output(app: tauri::AppHandle) -> Option<PickPathResult> {
    let picked = app
        .dialog()
        .file()
        .set_title("Save movie as")
        .blocking_save_file()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

#[tauri::command]
pub fn tasks_pick_spots_file(app: tauri::AppHandle) -> Option<PickPathResult> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select spots CSV")
        .blocking_pick_file()?;
    Some(PickPathResult {
        path: picked.to_string(),
    })
}

#[tauri::command]
pub fn tasks_has_bbox_csv(payload: HasBboxCsvRequest) -> bool {
    Path::new(&payload.workspace_path)
        .join(format!("Pos{}_bbox.csv", payload.pos))
        .exists()
}

#[tauri::command]
pub fn tasks_plan_convert(payload: RunConvertPlanRequest) -> RunConvertPlanResponse {
    let args = mupattern_rs::convert::ConvertArgs {
        input: payload.input,
        output: payload.output,
        pos: payload.pos,
        time: payload.time,
        yes: true,
        dry_run: true,
    };

    match mupattern_rs::convert::plan(&args) {
        Ok(plan) => RunConvertPlanResponse::Success(ConvertPlanSuccess {
            ok: true,
            output: plan.output_path,
            n_pos: plan.n_pos,
            n_time: plan.n_time,
            n_chan: plan.n_chan,
            n_z: plan.n_z,
            selected_positions: plan.positions.len(),
            selected_timepoints: plan.time_indices.len(),
            total_frames: plan.total_frames,
            positions: plan.positions,
            time_indices: plan.time_indices,
        }),
        Err(err) => RunConvertPlanResponse::Failure(ErrorResponse {
            ok: false,
            error: err.to_string(),
        }),
    }
}

#[tauri::command]
pub fn tasks_plan_crop(payload: RunCropPlanRequest) -> GenericPlanResponse {
    let args = mupattern_rs::crop::CropArgs {
        input: payload.input_dir,
        pos: payload.pos,
        bbox: payload.bbox,
        output: payload.output,
        background: payload.background,
        yes: true,
        dry_run: true,
    };

    match mupattern_rs::crop::plan(&args) {
        Ok(plan) => GenericPlanResponse::Success(GenericPlanSuccess {
            ok: true,
            task: "crop".to_string(),
            output: plan.output,
            summary: format!(
                "Crop plan: pos {}: bboxes={}, input frames={}, output frames={}, channels={}, times={}, z-slices={}",
                plan.pos,
                plan.n_bboxes,
                plan.n_input_frames,
                plan.total_output_frames,
                plan.n_channels,
                plan.n_times,
                plan.n_z
            ),
        }),
        Err(err) => GenericPlanResponse::Failure(ErrorResponse {
            ok: false,
            error: err.to_string(),
        }),
    }
}

#[tauri::command]
pub fn tasks_plan_expression_analyze(payload: RunExpressionAnalyzePlanRequest) -> GenericPlanResponse {
    let input = Path::new(&payload.workspace_path)
        .join("crops.zarr")
        .to_string_lossy()
        .to_string();
    let args = mupattern_rs::expression::ExpressionArgs {
        input,
        pos: payload.pos,
        channel: payload.channel,
        output: payload.output,
        yes: true,
        dry_run: true,
    };

    match mupattern_rs::expression::plan(&args) {
        Ok(plan) => GenericPlanResponse::Success(GenericPlanSuccess {
            ok: true,
            task: "expression".to_string(),
            output: plan.output,
            summary: format!(
                "Expression plan: pos {} channel {}: crops={}, times={}, channels={}, estimated rows={}",
                plan.pos, plan.channel, plan.n_crops, plan.n_times, plan.n_channels, plan.total_rows
            ),
        }),
        Err(err) => GenericPlanResponse::Failure(ErrorResponse {
            ok: false,
            error: err.to_string(),
        }),
    }
}

#[tauri::command]
pub fn tasks_plan_kill_predict(payload: RunKillPredictPlanRequest) -> GenericPlanResponse {
    let input = Path::new(&payload.workspace_path)
        .join("crops.zarr")
        .to_string_lossy()
        .to_string();
    let args = mupattern_rs::kill::KillArgs {
        input,
        pos: payload.pos,
        model: payload.model_path,
        output: payload.output,
        batch_size: payload.batch_size.unwrap_or(256),
        cpu: false,
        yes: true,
        dry_run: true,
    };
    match mupattern_rs::kill::plan(&args) {
        Ok(plan) => GenericPlanResponse::Success(GenericPlanSuccess {
            ok: true,
            task: "kill".to_string(),
            output: plan.output,
            summary: format!(
                "Kill plan: pos {}: crops={}, frames={}, channels={}, batch={}, model={}",
                plan.pos, plan.n_crops, plan.n_frames, plan.n_channels, plan.batch_size, plan.model
            ),
        }),
        Err(err) => GenericPlanResponse::Failure(ErrorResponse {
            ok: false,
            error: err.to_string(),
        }),
    }
}

#[tauri::command]
pub fn tasks_plan_tissue_analyze(payload: RunTissueAnalyzePlanRequest) -> GenericPlanResponse {
    let input = Path::new(&payload.workspace_path)
        .join("crops.zarr")
        .to_string_lossy()
        .to_string();
    let args = mupattern_rs::tissue::TissueArgs {
        input,
        pos: payload.pos,
        channel_phase: payload.channel_phase,
        channel_fluorescence: payload.channel_fluorescence,
        method: payload.method,
        model: payload.model,
        output: payload.output,
        masks: None,
        batch_size: 1,
        cpu: false,
        yes: true,
        dry_run: true,
    };
    match mupattern_rs::tissue::plan(&args) {
        Ok(plan) => GenericPlanResponse::Success(GenericPlanSuccess {
            ok: true,
            task: "tissue".to_string(),
            output: plan.output,
            summary: format!(
                "Tissue plan: pos {} method {}: crops={}, frames={}, phase ch={}, fluorescence ch={}",
                plan.pos, plan.method, plan.n_crops, plan.n_frames, plan.channel_phase, plan.channel_fluorescence
            ),
        }),
        Err(err) => GenericPlanResponse::Failure(ErrorResponse {
            ok: false,
            error: err.to_string(),
        }),
    }
}

#[tauri::command]
pub fn tasks_plan_movie(payload: RunMoviePlanRequest) -> GenericPlanResponse {
    let args = mupattern_rs::movie::MovieArgs {
        input: payload.input_zarr,
        pos: payload.pos,
        crop: payload.crop,
        channel: payload.channel,
        time: payload.time,
        output: payload.output,
        fps: payload.fps,
        colormap: payload.colormap,
        spots: payload.spots,
        ffmpeg: String::new(),
        yes: true,
        dry_run: true,
    };
    match mupattern_rs::movie::plan(&args) {
        Ok(plan) => {
            let output = plan.output;
            GenericPlanResponse::Success(GenericPlanSuccess {
                ok: true,
                task: "movie".to_string(),
                output: output.clone(),
                summary: format!(
                    "Movie plan: pos {}, crop {}, channel {}: selected {} / {} frames, channels={}, output={}",
                    plan.pos,
                    plan.crop,
                    plan.channel,
                    plan.selected_times,
                    plan.n_times,
                    plan.n_channels,
                    output
                ),
            })
        }
        Err(err) => GenericPlanResponse::Failure(ErrorResponse {
            ok: false,
            error: err.to_string(),
        }),
    }
}

#[tauri::command]
pub async fn tasks_run_convert(
    app: tauri::AppHandle,
    payload: RunConvertRequest,
) -> BasicTaskResponse {
    match tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(&app, "tasks:convert-progress", &task_id, progress, message);
        };
        let args = mupattern_rs::convert::ConvertArgs {
            input: payload.input,
            output: payload.output,
            pos: payload.pos,
            time: payload.time,
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::convert::run(args, emit) {
            Ok(()) => ok_basic(),
            Err(err) => err_basic(err.to_string()),
        }
    })
    .await
    {
        Ok(response) => response,
        Err(err) => err_basic(format!("failed to join convert task: {err}")),
    }
}

#[tauri::command]
pub fn tasks_start_convert(app: tauri::AppHandle, payload: RunConvertRequest) -> BasicTaskResponse {
    tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(&app, "tasks:convert-progress", &task_id, progress, message);
        };
        let args = mupattern_rs::convert::ConvertArgs {
            input: payload.input,
            output: payload.output,
            pos: payload.pos,
            time: payload.time,
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::convert::run(args, emit) {
            Ok(()) => {
                let _ = update_task_outcome(&app, &task_id, "succeeded", None, None);
            }
            Err(err) => {
                let _ = update_task_outcome(&app, &task_id, "failed", Some(err.to_string()), None);
            }
        }
    });
    ok_basic()
}

#[tauri::command]
pub fn tasks_start_crop(app: tauri::AppHandle, payload: RunCropRequest) -> BasicTaskResponse {
    tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(&app, "tasks:crop-progress", &task_id, progress, message);
        };
        let args = mupattern_rs::crop::CropArgs {
            input: payload.input_dir,
            pos: payload.pos,
            bbox: payload.bbox,
            output: payload.output,
            background: payload.background,
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::crop::run(args, emit) {
            Ok(()) => {
                let _ = update_task_outcome(&app, &task_id, "succeeded", None, None);
            }
            Err(err) => {
                let _ = update_task_outcome(&app, &task_id, "failed", Some(err.to_string()), None);
            }
        }
    });
    ok_basic()
}

#[tauri::command]
pub fn tasks_start_expression_analyze(
    app: tauri::AppHandle,
    payload: RunExpressionAnalyzeRequest,
) -> BasicTaskResponse {
    tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(
                &app,
                "tasks:expression-analyze-progress",
                &task_id,
                progress,
                message,
            );
        };
        let input = Path::new(&payload.workspace_path)
            .join("crops.zarr")
            .to_string_lossy()
            .to_string();
        let output = payload.output.clone();
        let args = mupattern_rs::expression::ExpressionArgs {
            input,
            pos: payload.pos,
            channel: payload.channel,
            output: output.clone(),
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::expression::run(args, emit) {
            Ok(()) => {
                let _ = update_task_outcome(
                    &app,
                    &task_id,
                    "succeeded",
                    None,
                    Some(serde_json::json!({ "output": output })),
                );
            }
            Err(err) => {
                let _ = update_task_outcome(&app, &task_id, "failed", Some(err.to_string()), None);
            }
        }
    });
    ok_basic()
}

#[tauri::command]
pub fn tasks_start_kill_predict(
    app: tauri::AppHandle,
    payload: RunKillPredictRequest,
) -> BasicTaskResponse {
    tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(&app, "tasks:kill-predict-progress", &task_id, progress, message);
        };
        let input = Path::new(&payload.workspace_path)
            .join("crops.zarr")
            .to_string_lossy()
            .to_string();
        let output = payload.output.clone();
        let args = mupattern_rs::kill::KillArgs {
            input,
            pos: payload.pos,
            model: payload.model_path,
            output: output.clone(),
            batch_size: payload.batch_size.unwrap_or(256),
            cpu: false,
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::kill::run(args, emit) {
            Ok(()) => {
                let _ = update_task_outcome(
                    &app,
                    &task_id,
                    "succeeded",
                    None,
                    Some(serde_json::json!({ "output": output })),
                );
            }
            Err(err) => {
                let _ = update_task_outcome(&app, &task_id, "failed", Some(err.to_string()), None);
            }
        }
    });
    ok_basic()
}

#[tauri::command]
pub fn tasks_start_tissue_analyze(
    app: tauri::AppHandle,
    payload: RunTissueAnalyzeRequest,
) -> BasicTaskResponse {
    tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(
                &app,
                "tasks:tissue-analyze-progress",
                &task_id,
                progress,
                message,
            );
        };
        let input = Path::new(&payload.workspace_path)
            .join("crops.zarr")
            .to_string_lossy()
            .to_string();
        let output = payload.output.clone();
        let args = mupattern_rs::tissue::TissueArgs {
            input,
            pos: payload.pos,
            channel_phase: payload.channel_phase,
            channel_fluorescence: payload.channel_fluorescence,
            method: payload.method,
            model: payload.model,
            output: output.clone(),
            masks: None,
            batch_size: 1,
            cpu: false,
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::tissue::run(args, emit) {
            Ok(()) => {
                let _ = update_task_outcome(
                    &app,
                    &task_id,
                    "succeeded",
                    None,
                    Some(serde_json::json!({ "output": output })),
                );
            }
            Err(err) => {
                let _ = update_task_outcome(&app, &task_id, "failed", Some(err.to_string()), None);
            }
        }
    });
    ok_basic()
}

#[tauri::command]
pub fn tasks_start_movie(app: tauri::AppHandle, payload: RunMovieRequest) -> BasicTaskResponse {
    tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(&app, "tasks:movie-progress", &task_id, progress, message);
        };
        let ffmpeg = match find_ffmpeg() {
            Some(path) => path,
            None => {
                let _ = update_task_outcome(
                    &app,
                    &task_id,
                    "failed",
                    Some("ffmpeg not found. Install ffmpeg and ensure it is available in PATH.".to_string()),
                    None,
                );
                return;
            }
        };
        let args = mupattern_rs::movie::MovieArgs {
            input: payload.input_zarr,
            pos: payload.pos,
            crop: payload.crop,
            channel: payload.channel,
            time: payload.time,
            output: payload.output,
            fps: payload.fps,
            colormap: payload.colormap,
            spots: payload.spots,
            ffmpeg,
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::movie::run(args, emit) {
            Ok(()) => {
                let _ = update_task_outcome(&app, &task_id, "succeeded", None, None);
            }
            Err(err) => {
                let _ = update_task_outcome(&app, &task_id, "failed", Some(err.to_string()), None);
            }
        }
    });
    ok_basic()
}

#[tauri::command]
pub async fn tasks_run_crop(app: tauri::AppHandle, payload: RunCropRequest) -> BasicTaskResponse {
    match tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(&app, "tasks:crop-progress", &task_id, progress, message);
        };
        let args = mupattern_rs::crop::CropArgs {
            input: payload.input_dir,
            pos: payload.pos,
            bbox: payload.bbox,
            output: payload.output,
            background: payload.background,
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::crop::run(args, emit) {
            Ok(()) => ok_basic(),
            Err(err) => err_basic(err.to_string()),
        }
    })
    .await
    {
        Ok(response) => response,
        Err(err) => err_basic(format!("failed to join crop task: {err}")),
    }
}

#[tauri::command]
pub async fn tasks_run_expression_analyze(
    app: tauri::AppHandle,
    payload: RunExpressionAnalyzeRequest,
) -> RunExpressionAnalyzeResponse {
    match tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(
                &app,
                "tasks:expression-analyze-progress",
                &task_id,
                progress,
                message,
            );
        };
        let input = Path::new(&payload.workspace_path)
            .join("crops.zarr")
            .to_string_lossy()
            .to_string();
        let output = payload.output.clone();
        let args = mupattern_rs::expression::ExpressionArgs {
            input,
            pos: payload.pos,
            channel: payload.channel,
            output: output.clone(),
            yes: true,
            dry_run: false,
        };
        if let Err(err) = mupattern_rs::expression::run(args, emit) {
            return RunExpressionAnalyzeResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            });
        }
        match parse_expression_csv(Path::new(&output)) {
            Ok(rows) => RunExpressionAnalyzeResponse::Success(RunExpressionAnalyzeSuccess {
                ok: true,
                output,
                rows,
            }),
            Err(error) => RunExpressionAnalyzeResponse::Failure(ErrorResponse { ok: false, error }),
        }
    })
    .await
    {
        Ok(response) => response,
        Err(err) => RunExpressionAnalyzeResponse::Failure(ErrorResponse {
            ok: false,
            error: format!("failed to join expression task: {err}"),
        }),
    }
}

#[tauri::command]
pub async fn tasks_run_kill_predict(
    app: tauri::AppHandle,
    payload: RunKillPredictRequest,
) -> RunKillPredictResponse {
    match tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(&app, "tasks:kill-predict-progress", &task_id, progress, message);
        };
        let input = Path::new(&payload.workspace_path)
            .join("crops.zarr")
            .to_string_lossy()
            .to_string();
        let output = payload.output.clone();
        let args = mupattern_rs::kill::KillArgs {
            input,
            pos: payload.pos,
            model: payload.model_path,
            output: output.clone(),
            batch_size: payload.batch_size.unwrap_or(256),
            cpu: false,
            yes: true,
            dry_run: false,
        };
        if let Err(err) = mupattern_rs::kill::run(args, emit) {
            return RunKillPredictResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            });
        }
        match parse_kill_csv(Path::new(&output)) {
            Ok(rows) => RunKillPredictResponse::Success(RunKillPredictSuccess {
                ok: true,
                output,
                rows,
            }),
            Err(error) => RunKillPredictResponse::Failure(ErrorResponse { ok: false, error }),
        }
    })
    .await
    {
        Ok(response) => response,
        Err(err) => RunKillPredictResponse::Failure(ErrorResponse {
            ok: false,
            error: format!("failed to join kill task: {err}"),
        }),
    }
}

#[tauri::command]
pub async fn tasks_run_tissue_analyze(
    app: tauri::AppHandle,
    payload: RunTissueAnalyzeRequest,
) -> RunTissueAnalyzeResponse {
    match tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(
                &app,
                "tasks:tissue-analyze-progress",
                &task_id,
                progress,
                message,
            );
        };
        let input = Path::new(&payload.workspace_path)
            .join("crops.zarr")
            .to_string_lossy()
            .to_string();
        let output = payload.output.clone();
        let args = mupattern_rs::tissue::TissueArgs {
            input,
            pos: payload.pos,
            channel_phase: payload.channel_phase,
            channel_fluorescence: payload.channel_fluorescence,
            method: payload.method,
            model: payload.model,
            output: output.clone(),
            masks: None,
            batch_size: 1,
            cpu: false,
            yes: true,
            dry_run: false,
        };
        if let Err(err) = mupattern_rs::tissue::run(args, emit) {
            return RunTissueAnalyzeResponse::Failure(ErrorResponse {
                ok: false,
                error: err.to_string(),
            });
        }
        match parse_tissue_csv(Path::new(&output)) {
            Ok(rows) => RunTissueAnalyzeResponse::Success(RunTissueAnalyzeSuccess {
                ok: true,
                output,
                rows,
            }),
            Err(error) => RunTissueAnalyzeResponse::Failure(ErrorResponse { ok: false, error }),
        }
    })
    .await
    {
        Ok(response) => response,
        Err(err) => RunTissueAnalyzeResponse::Failure(ErrorResponse {
            ok: false,
            error: format!("failed to join tissue task: {err}"),
        }),
    }
}

#[tauri::command]
pub async fn tasks_run_movie(app: tauri::AppHandle, payload: RunMovieRequest) -> BasicTaskResponse {
    match tauri::async_runtime::spawn_blocking(move || {
        let task_id = payload.task_id.clone();
        let emit = |progress: f64, message: &str| {
            emit_task_progress(&app, "tasks:movie-progress", &task_id, progress, message);
        };
        let ffmpeg = match find_ffmpeg() {
            Some(path) => path,
            None => {
                return err_basic(
                    "ffmpeg not found. Install ffmpeg and ensure it is available in PATH.",
                )
            }
        };
        let args = mupattern_rs::movie::MovieArgs {
            input: payload.input_zarr,
            pos: payload.pos,
            crop: payload.crop,
            channel: payload.channel,
            time: payload.time,
            output: payload.output,
            fps: payload.fps,
            colormap: payload.colormap,
            spots: payload.spots,
            ffmpeg,
            yes: true,
            dry_run: false,
        };
        match mupattern_rs::movie::run(args, emit) {
            Ok(()) => ok_basic(),
            Err(err) => err_basic(err.to_string()),
        }
    })
    .await
    {
        Ok(response) => response,
        Err(err) => err_basic(format!("failed to join movie task: {err}")),
    }
}

#[tauri::command]
pub fn tasks_insert_task(app: tauri::AppHandle, task: serde_json::Value) -> Result<bool, String> {
    with_tasks_state_lock(|| {
        let mut tasks = load_tasks_state(&app)?;
        tasks.push(task);
        save_tasks_state(&app, &tasks)?;
        Ok(true)
    })
}

#[tauri::command]
pub fn tasks_update_task(app: tauri::AppHandle, payload: UpdateTaskRequest) -> Result<bool, String> {
    with_tasks_state_lock(|| {
        let mut tasks = load_tasks_state(&app)?;
        let updates_obj = payload
            .updates
            .as_object()
            .ok_or_else(|| "updates must be a JSON object".to_string())?;
        let mut updated = false;

        for task in &mut tasks {
            let is_target = task
                .get("id")
                .and_then(|value| value.as_str())
                .map(|id| id == payload.id)
                .unwrap_or(false);
            if !is_target {
                continue;
            }
            if let Some(task_obj) = task.as_object_mut() {
                for (key, value) in updates_obj {
                    task_obj.insert(key.clone(), value.clone());
                }
                updated = true;
                break;
            }
        }

        if !updated {
            return Err(format!("task not found: {}", payload.id));
        }

        save_tasks_state(&app, &tasks)?;
        Ok(true)
    })
}

#[tauri::command]
pub fn tasks_list_tasks(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    with_tasks_state_lock(|| load_tasks_state(&app))
}

#[tauri::command]
pub fn tasks_delete_completed_tasks(app: tauri::AppHandle) -> Result<bool, String> {
    with_tasks_state_lock(|| {
        let mut tasks = load_tasks_state(&app)?;
        tasks.retain(|task| {
            task.get("status")
                .and_then(|value| value.as_str())
                .map(|status| status == "running" || status == "queued")
                .unwrap_or(false)
        });
        save_tasks_state(&app, &tasks)?;
        Ok(true)
    })
}

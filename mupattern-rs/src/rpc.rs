use clap::Args;
use csv::StringRecord;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::Path;

const LOG_RETURN_LAG_FRAMES: usize = 10;
const LOG_RETURN_EPS: f64 = 1e-9;
const FLATNESS_N_FRAMES_FACTOR: f64 = 0.8;

#[derive(Args, Clone, Default)]
pub struct RpcServerArgs {}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExpressionTraceSeries {
    pub crop: String,
    pub t: Vec<f64>,
    pub intensity: Vec<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExpressionTraceMetrics {
    pub crop: String,
    #[serde(rename = "rangeP90P10")]
    pub range_p90_p10: f64,
    #[serde(rename = "flatnessScore")]
    pub flatness_score: f64,
    #[serde(rename = "lagLogReturns")]
    pub lag_log_returns: Vec<f64>,
    #[serde(rename = "minLagLogReturn")]
    pub min_lag_log_return: f64,
}

#[derive(Clone, Debug)]
struct ExpressionDataset {
    series: Vec<ExpressionTraceSeries>,
    metrics: Vec<ExpressionTraceMetrics>,
}

#[derive(Default)]
struct RpcServerState {
    datasets: HashMap<String, ExpressionDataset>,
    next_dataset_seq: u64,
    shutdown_requested: bool,
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Debug)]
struct RpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpressionLoadCsvParams {
    csv_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpressionFilterParams {
    dataset_id: String,
    hide_flat: bool,
    flatness_threshold: f64,
    hide_drop: bool,
    log_return_threshold: f64,
    min_consecutive: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpressionReleaseParams {
    dataset_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpressionFilterResult {
    selected_crops: Vec<String>,
    total_count: usize,
    drop_count: usize,
}

pub fn run(_args: RpcServerArgs) -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let mut state = RpcServerState::default();
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<JsonRpcRequest>(trimmed) {
            Ok(req) => handle_json_rpc_request(&mut state, req),
            Err(err) => Some(error_response(
                Value::Null,
                RpcError::parse_error(format!("Invalid JSON-RPC payload: {err}")),
            )),
        };

        if let Some(resp) = response {
            let encoded = serde_json::to_string(&resp)?;
            writeln!(writer, "{encoded}")?;
            writer.flush()?;
        }

        if state.shutdown_requested {
            break;
        }
    }

    Ok(())
}

fn handle_json_rpc_request(
    state: &mut RpcServerState,
    req: JsonRpcRequest,
) -> Option<JsonRpcResponse> {
    if req.jsonrpc != "2.0" {
        return Some(error_response(
            req.id.unwrap_or(Value::Null),
            RpcError::invalid_request("jsonrpc must be \"2.0\""),
        ));
    }

    let req_id = req.id.clone();
    let result = handle_rpc_method(state, &req.method, req.params);

    match req_id {
        Some(id) => Some(match result {
            Ok(value) => success_response(id, value),
            Err(err) => error_response(id, err),
        }),
        None => None,
    }
}

fn handle_rpc_method(
    state: &mut RpcServerState,
    method: &str,
    params: Value,
) -> Result<Value, RpcError> {
    match method {
        "server.ping" => {
            ensure_no_params(params)?;
            Ok(json!({ "ok": true }))
        }
        "expression.loadCsv" => {
            let p: ExpressionLoadCsvParams = parse_required_params(params)?;
            if p.csv_path.trim().is_empty() {
                return Err(RpcError::invalid_params("csvPath must be non-empty"));
            }
            let (series, metrics) = parse_expression_csv(&p.csv_path).map_err(|msg| {
                RpcError::server_error(format!("expression.loadCsv failed: {msg}"))
            })?;
            let dataset_id = next_dataset_id(state);
            state.datasets.insert(
                dataset_id.clone(),
                ExpressionDataset {
                    series: series.clone(),
                    metrics: metrics.clone(),
                },
            );
            Ok(json!({
                "datasetId": dataset_id,
                "series": series,
                "metrics": metrics,
            }))
        }
        "expression.filter" => {
            let p: ExpressionFilterParams = parse_required_params(params)?;
            if p.dataset_id.trim().is_empty() {
                return Err(RpcError::invalid_params("datasetId must be non-empty"));
            }
            let dataset = state
                .datasets
                .get(&p.dataset_id)
                .ok_or_else(|| RpcError::invalid_params("Unknown datasetId"))?;
            let result = filter_expression_dataset(dataset, &p);
            serde_json::to_value(result).map_err(|err| {
                RpcError::internal(format!("Failed to serialize filter result: {err}"))
            })
        }
        "expression.release" => {
            let p: ExpressionReleaseParams = parse_required_params(params)?;
            if p.dataset_id.trim().is_empty() {
                return Err(RpcError::invalid_params("datasetId must be non-empty"));
            }
            let released = state.datasets.remove(&p.dataset_id).is_some();
            Ok(json!({ "released": released }))
        }
        "server.shutdown" => {
            ensure_no_params(params)?;
            state.shutdown_requested = true;
            Ok(json!({ "ok": true }))
        }
        _ => Err(RpcError::method_not_found(format!(
            "Method not found: {method}"
        ))),
    }
}

fn parse_required_params<T>(params: Value) -> Result<T, RpcError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(params)
        .map_err(|err| RpcError::invalid_params(format!("Invalid params: {err}")))
}

fn ensure_no_params(params: Value) -> Result<(), RpcError> {
    match params {
        Value::Null => Ok(()),
        Value::Object(map) if map.is_empty() => Ok(()),
        _ => Err(RpcError::invalid_params(
            "This method does not accept params",
        )),
    }
}

fn next_dataset_id(state: &mut RpcServerState) -> String {
    state.next_dataset_seq = state.next_dataset_seq.saturating_add(1);
    format!("expr-{}", state.next_dataset_seq)
}

fn success_response(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

fn error_response(id: Value, err: RpcError) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError {
            code: err.code,
            message: err.message,
        }),
    }
}

fn find_header_index(headers: &StringRecord, name: &str) -> Option<usize> {
    headers
        .iter()
        .position(|h| h.trim().eq_ignore_ascii_case(name))
}

fn parse_expression_csv<P: AsRef<Path>>(
    csv_path: P,
) -> Result<(Vec<ExpressionTraceSeries>, Vec<ExpressionTraceMetrics>), String> {
    let file = File::open(csv_path.as_ref()).map_err(|err| format!("open csv: {err}"))?;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(file);
    let headers = reader
        .headers()
        .map_err(|err| format!("read header: {err}"))?
        .clone();

    let t_idx = find_header_index(&headers, "t").ok_or_else(|| "missing header: t".to_string())?;
    let crop_idx =
        find_header_index(&headers, "crop").ok_or_else(|| "missing header: crop".to_string())?;
    let intensity_idx = find_header_index(&headers, "intensity")
        .ok_or_else(|| "missing header: intensity".to_string())?;
    let area_idx =
        find_header_index(&headers, "area").ok_or_else(|| "missing header: area".to_string())?;
    let background_idx = find_header_index(&headers, "background")
        .ok_or_else(|| "missing header: background".to_string())?;

    let mut by_crop: HashMap<String, Vec<(f64, f64)>> = HashMap::new();
    for (row_idx, record) in reader.records().enumerate() {
        let record = record.map_err(|err| format!("read row {}: {err}", row_idx + 2))?;
        let t_raw = record
            .get(t_idx)
            .ok_or_else(|| format!("missing t at row {}", row_idx + 2))?;
        let crop = record
            .get(crop_idx)
            .ok_or_else(|| format!("missing crop at row {}", row_idx + 2))?
            .trim()
            .to_string();
        if crop.is_empty() {
            return Err(format!("empty crop at row {}", row_idx + 2));
        }
        let raw_intensity = parse_f64_field(record.get(intensity_idx), "intensity", row_idx + 2)?;
        let area = parse_f64_field(record.get(area_idx), "area", row_idx + 2)?;
        let background = parse_f64_field(record.get(background_idx), "background", row_idx + 2)?;
        let t = t_raw
            .trim()
            .parse::<f64>()
            .map_err(|err| format!("invalid t at row {}: {err}", row_idx + 2))?;
        let corrected_intensity = raw_intensity - area * background;
        by_crop
            .entry(crop)
            .or_default()
            .push((t, corrected_intensity));
    }

    let mut series: Vec<ExpressionTraceSeries> = by_crop
        .into_iter()
        .map(|(crop, mut points)| {
            points.sort_by(|a, b| a.0.total_cmp(&b.0));
            ExpressionTraceSeries {
                crop,
                t: points.iter().map(|(t, _)| *t).collect(),
                intensity: points.iter().map(|(_, intensity)| *intensity).collect(),
            }
        })
        .collect();
    series.sort_by(|a, b| a.crop.cmp(&b.crop));

    let metrics = compute_expression_metrics(&series);
    Ok((series, metrics))
}

fn parse_f64_field(value: Option<&str>, field: &str, row_number: usize) -> Result<f64, String> {
    value
        .ok_or_else(|| format!("missing {field} at row {row_number}"))?
        .trim()
        .parse::<f64>()
        .map_err(|err| format!("invalid {field} at row {row_number}: {err}"))
}

fn quantile(values: &[f64], q: f64) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let pos = (sorted.len() as f64 - 1.0) * q;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    if lo == hi {
        return sorted[lo];
    }
    let w = pos - lo as f64;
    sorted[lo] * (1.0 - w) + sorted[hi] * w
}

fn robust_range(values: &[f64]) -> f64 {
    if values.len() <= 1 {
        return 0.0;
    }
    quantile(values, 0.9) - quantile(values, 0.1)
}

fn compute_lag_log_returns(values: &[f64], lag_frames: usize) -> Vec<f64> {
    let lag = lag_frames.max(1);
    if values.len() <= lag {
        return Vec::new();
    }
    let mut out = Vec::new();
    for i in 0..(values.len() - lag) {
        let v0 = values[i];
        let v1 = values[i + lag];
        if !v0.is_finite() || !v1.is_finite() {
            continue;
        }
        if v0 <= LOG_RETURN_EPS || v1 <= LOG_RETURN_EPS {
            continue;
        }
        out.push((v1 / v0).ln());
    }
    out
}

fn compute_expression_metrics(series: &[ExpressionTraceSeries]) -> Vec<ExpressionTraceMetrics> {
    series
        .iter()
        .map(|trace| {
            let p90_p10 = robust_range(&trace.intensity);
            let n_frames = trace.t.len() as f64;
            let flatness_score = if n_frames > 0.0 {
                p90_p10 / (FLATNESS_N_FRAMES_FACTOR * n_frames).max(1.0)
            } else {
                0.0
            };
            let lag_log_returns = compute_lag_log_returns(&trace.intensity, LOG_RETURN_LAG_FRAMES);
            let min_lag_log_return = lag_log_returns
                .iter()
                .copied()
                .reduce(f64::min)
                .unwrap_or(f64::NAN);

            ExpressionTraceMetrics {
                crop: trace.crop.clone(),
                range_p90_p10: p90_p10,
                flatness_score,
                lag_log_returns,
                min_lag_log_return,
            }
        })
        .collect()
}

fn has_consecutive_drops(values: &[f64], threshold: f64, min_consecutive: usize) -> bool {
    let needed = min_consecutive.max(1);
    let mut run = 0usize;
    for v in values {
        if *v <= threshold {
            run += 1;
            if run >= needed {
                return true;
            }
        } else {
            run = 0;
        }
    }
    false
}

fn filter_expression_dataset(
    dataset: &ExpressionDataset,
    params: &ExpressionFilterParams,
) -> ExpressionFilterResult {
    let mut selected_crops = Vec::new();
    let mut drop_count = 0usize;

    for metric in &dataset.metrics {
        let is_flat =
            metric.range_p90_p10 <= 0.0 || metric.flatness_score < params.flatness_threshold;
        let has_drop = has_consecutive_drops(
            &metric.lag_log_returns,
            params.log_return_threshold,
            params.min_consecutive,
        );
        if has_drop {
            drop_count += 1;
        }
        if (!params.hide_flat || !is_flat) && (!params.hide_drop || !has_drop) {
            selected_crops.push(metric.crop.clone());
        }
    }

    selected_crops.sort();
    ExpressionFilterResult {
        selected_crops,
        total_count: dataset.series.len(),
        drop_count,
    }
}

impl RpcError {
    fn parse_error(message: impl Into<String>) -> Self {
        Self {
            code: -32700,
            message: message.into(),
        }
    }

    fn invalid_request(message: impl Into<String>) -> Self {
        Self {
            code: -32600,
            message: message.into(),
        }
    }

    fn method_not_found(message: impl Into<String>) -> Self {
        Self {
            code: -32601,
            message: message.into(),
        }
    }

    fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: -32602,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            code: -32603,
            message: message.into(),
        }
    }

    fn server_error(message: impl Into<String>) -> Self {
        Self {
            code: -32000,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

    fn write_temp_csv(content: &str) -> String {
        let mut path = std::env::temp_dir();
        let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
        path.push(format!("mupattern-rpc-test-{seq}.csv"));
        std::fs::write(&path, content).expect("write temp csv");
        path.to_string_lossy().to_string()
    }

    #[test]
    fn parse_groups_series_and_background_subtracts() {
        let csv = "t,crop,intensity,area,background\n\
1,crop1,30,10,2\n\
0,crop1,20,10,1\n\
0,crop2,15,5,1\n";
        let path = write_temp_csv(csv);
        let (series, metrics) = parse_expression_csv(&path).expect("parse");

        let mut by_crop = HashMap::new();
        for s in series {
            by_crop.insert(s.crop.clone(), s);
        }

        let crop1 = by_crop.get("crop1").expect("crop1");
        assert_eq!(crop1.t, vec![0.0, 1.0]);
        assert_eq!(crop1.intensity, vec![10.0, 10.0]);
        assert_eq!(crop1.t.len(), crop1.intensity.len());

        let crop2 = by_crop.get("crop2").expect("crop2");
        assert_eq!(crop2.t, vec![0.0]);
        assert_eq!(crop2.intensity, vec![10.0]);
        assert_eq!(crop2.t.len(), crop2.intensity.len());

        assert_eq!(metrics.len(), 2);
    }

    #[test]
    fn metrics_skip_non_positive_log_return_pairs() {
        let series = vec![ExpressionTraceSeries {
            crop: "c1".to_string(),
            t: (0..12).map(|v| v as f64).collect(),
            intensity: vec![10.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 5.0, 5.0],
        }];
        let metrics = compute_expression_metrics(&series);
        assert_eq!(metrics.len(), 1);
        let m = &metrics[0];
        assert_eq!(m.lag_log_returns.len(), 1);
        let expected = (0.5f64).ln();
        assert!((m.lag_log_returns[0] - expected).abs() < 1e-12);
        assert!((m.min_lag_log_return - expected).abs() < 1e-12);
    }

    #[test]
    fn filter_applies_flat_and_drop_criteria() {
        let dataset = ExpressionDataset {
            series: vec![
                ExpressionTraceSeries {
                    crop: "A".to_string(),
                    t: vec![0.0],
                    intensity: vec![1.0],
                },
                ExpressionTraceSeries {
                    crop: "B".to_string(),
                    t: vec![0.0],
                    intensity: vec![1.0],
                },
                ExpressionTraceSeries {
                    crop: "C".to_string(),
                    t: vec![0.0],
                    intensity: vec![1.0],
                },
            ],
            metrics: vec![
                ExpressionTraceMetrics {
                    crop: "A".to_string(),
                    range_p90_p10: 1.0,
                    flatness_score: 1.0,
                    lag_log_returns: vec![-1.0, -1.1, -0.2],
                    min_lag_log_return: -1.1,
                },
                ExpressionTraceMetrics {
                    crop: "B".to_string(),
                    range_p90_p10: 2.0,
                    flatness_score: 2.0,
                    lag_log_returns: vec![-0.1, -0.2],
                    min_lag_log_return: -0.2,
                },
                ExpressionTraceMetrics {
                    crop: "C".to_string(),
                    range_p90_p10: 0.1,
                    flatness_score: 0.1,
                    lag_log_returns: vec![-0.2],
                    min_lag_log_return: -0.2,
                },
            ],
        };

        let params = ExpressionFilterParams {
            dataset_id: "ignored".to_string(),
            hide_flat: true,
            flatness_threshold: 0.5,
            hide_drop: true,
            log_return_threshold: -0.8,
            min_consecutive: 2,
        };

        let result = filter_expression_dataset(&dataset, &params);
        assert_eq!(result.selected_crops, vec!["B"]);
        assert_eq!(result.total_count, 3);
        assert_eq!(result.drop_count, 1);
    }

    #[test]
    fn rpc_dispatch_load_filter_release_shutdown() {
        let csv = "t,crop,intensity,area,background\n0,crop1,10,2,1\n1,crop1,12,2,1\n";
        let path = write_temp_csv(csv);
        let mut state = RpcServerState::default();

        let load_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: "expression.loadCsv".to_string(),
            params: json!({ "csvPath": path }),
        };
        let load_resp = handle_json_rpc_request(&mut state, load_req).expect("response");
        assert!(load_resp.error.is_none());
        let dataset_id = load_resp
            .result
            .as_ref()
            .and_then(|v| v.get("datasetId"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        assert!(!dataset_id.is_empty());

        let filter_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(2)),
            method: "expression.filter".to_string(),
            params: json!({
                "datasetId": dataset_id,
                "hideFlat": true,
                "flatnessThreshold": 0.0,
                "hideDrop": true,
                "logReturnThreshold": -0.693,
                "minConsecutive": 2
            }),
        };
        let filter_resp = handle_json_rpc_request(&mut state, filter_req).expect("response");
        assert!(filter_resp.error.is_none());
        assert!(filter_resp.result.is_some());

        let release_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(3)),
            method: "expression.release".to_string(),
            params: json!({ "datasetId": "expr-1" }),
        };
        let release_resp = handle_json_rpc_request(&mut state, release_req).expect("response");
        assert!(release_resp.error.is_none());

        let shutdown_req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(4)),
            method: "server.shutdown".to_string(),
            params: json!({}),
        };
        let shutdown_resp = handle_json_rpc_request(&mut state, shutdown_req).expect("response");
        assert!(shutdown_resp.error.is_none());
        assert!(state.shutdown_requested);
    }
}

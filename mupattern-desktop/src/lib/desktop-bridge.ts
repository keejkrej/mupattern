import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type WorkspaceRescanResult = {
  path: string;
  name: string;
  positions: number[];
  channels: number[];
  times: number[];
  zSlices: number[];
};

type ExpressionTraceSeries = {
  crop: string;
  t: number[];
  intensity: number[];
};

type ExpressionTraceMetrics = {
  crop: string;
  rangeP90P10: number;
  flatnessScore: number;
  lagLogReturns: number[];
  minLagLogReturn: number;
};

type ExpressionDataset = {
  series: ExpressionTraceSeries[];
  metrics: ExpressionTraceMetrics[];
};

type ExpressionRow = {
  t: number;
  crop: string;
  intensity: number;
  area: number;
  background: number;
};

const expressionDatasets = new Map<string, ExpressionDataset>();
let expressionDatasetCounter = 1;

function nextExpressionDatasetId(): string {
  const id = `expr-${expressionDatasetCounter}`;
  expressionDatasetCounter += 1;
  return id;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo] ?? 0;
  const w = rank - lo;
  return (sorted[lo] ?? 0) * (1 - w) + (sorted[hi] ?? 0) * w;
}

function buildExpressionDataset(rows: ExpressionRow[]): {
  datasetId: string;
  series: ExpressionTraceSeries[];
  metrics: ExpressionTraceMetrics[];
} {
  const byCrop = new Map<string, Array<{ t: number; corrected: number }>>();
  for (const row of rows) {
    const corrected = row.intensity - row.area * row.background;
    const list = byCrop.get(row.crop) ?? [];
    list.push({ t: row.t, corrected });
    byCrop.set(row.crop, list);
  }

  const series: ExpressionTraceSeries[] = [];
  const metrics: ExpressionTraceMetrics[] = [];

  for (const [crop, points] of byCrop.entries()) {
    points.sort((a, b) => a.t - b.t);
    const t = points.map((p) => p.t);
    const intensity = points.map((p) => p.corrected);
    series.push({ crop, t, intensity });

    const sorted = [...intensity].sort((a, b) => a - b);
    const p10 = percentile(sorted, 0.1);
    const p90 = percentile(sorted, 0.9);
    const rangeP90P10 = p90 - p10;
    const flatnessScore =
      intensity.length > 0 ? rangeP90P10 / (0.8 * intensity.length) : 0;

    const lagLogReturns: number[] = [];
    for (let i = 10; i < intensity.length; i += 1) {
      const prev = Math.max(0, intensity[i - 10] ?? 0) + 1;
      const cur = Math.max(0, intensity[i] ?? 0) + 1;
      lagLogReturns.push(Math.log(cur / prev));
    }
    const minLagLogReturn =
      lagLogReturns.length > 0 ? Math.min(...lagLogReturns) : 0;

    metrics.push({
      crop,
      rangeP90P10,
      flatnessScore,
      lagLogReturns,
      minLagLogReturn,
    });
  }

  series.sort((a, b) => a.crop.localeCompare(b.crop, undefined, { numeric: true }));
  metrics.sort((a, b) => a.crop.localeCompare(b.crop, undefined, { numeric: true }));
  const datasetId = nextExpressionDatasetId();
  expressionDatasets.set(datasetId, { series, metrics });
  return { datasetId, series, metrics };
}

function isDropTrace(
  metric: ExpressionTraceMetrics,
  threshold: number,
  minConsecutive: number,
): boolean {
  const required = Math.max(1, Math.floor(minConsecutive));
  let run = 0;
  for (const value of metric.lagLogReturns) {
    if (value <= threshold) {
      run += 1;
      if (run >= required) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function normalizeArrayBuffer(
  value: unknown,
  kind: "u8" | "u16" | "u32",
): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) {
    if (kind === "u8") return Uint8Array.from(value as number[]).buffer;
    if (kind === "u16") return new Uint16Array(value as number[]).buffer;
    return new Uint32Array(value as number[]).buffer;
  }
  return new ArrayBuffer(0);
}

async function rescanOrFallback(path: string): Promise<WorkspaceRescanResult> {
  const scan = await invoke<WorkspaceRescanResult | null>("workspace_rescan_directory", {
    path,
  });
  if (scan) return scan;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return {
    path,
    name: parts[parts.length - 1] ?? path,
    positions: [],
    channels: [],
    times: [],
    zSlices: [],
  };
}

function subscribeProgress(
  eventName: string,
  callback: (ev: { taskId: string; progress: number; message: string }) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  void listen<{ taskId?: string; progress: number; message: string }>(
    eventName,
    (event) => {
      callback({
        taskId: event.payload.taskId ?? "",
        progress: event.payload.progress,
        message: event.payload.message,
      });
    },
  ).then((fn) => {
    unlisten = fn;
  });
  return () => unlisten?.();
}

function ensureBridge() {
  if (typeof window === "undefined" || window.mupatternDesktop) return;

  window.mupatternDesktop = {
    platform: "tauri",
    workspaceState: {
      load: () => invoke("workspace_state_load"),
      save: (state) => invoke("workspace_state_save", { state }),
    },
    workspace: {
      pickDirectory: async () => {
        const selectedFromCommand = await invoke<string | null>("pick_directory");
        return selectedFromCommand ? rescanOrFallback(selectedFromCommand) : null;
      },
      pathExists: (path: string) => invoke("workspace_path_exists", { path }),
      rescanDirectory: (path: string) =>
        invoke<WorkspaceRescanResult | null>("workspace_rescan_directory", { path }),
      pickTagsFile: () => invoke<string | null>("workspace_pick_tags_file"),
      readPositionImage: async (request) => {
        const result = await invoke<
          | {
              ok: true;
              baseName: string;
              width: number;
              height: number;
              rgba: unknown;
            }
          | { ok: false; error: string }
        >("workspace_read_position_image", { request });
        if (!result.ok) return result;
        return {
          ...result,
          rgba: normalizeArrayBuffer(result.rgba, "u8"),
        };
      },
      saveBboxCsv: (request) => invoke("workspace_save_bbox_csv", { payload: request }),
    },
    zarr: {
      discover: (request) => invoke("zarr_discover", { request }),
      loadFrame: async (request) => {
        const result = await invoke<
          | { ok: true; width: number; height: number; data: unknown }
          | { ok: false; error: string }
        >("zarr_load_frame", { request });
        if (!result.ok) return result;
        return { ...result, data: normalizeArrayBuffer(result.data, "u16") };
      },
      hasMasks: (request) => invoke("zarr_has_masks", { request }),
      loadMaskFrame: async (request) => {
        const result = await invoke<
          | { ok: true; width: number; height: number; data: unknown }
          | { ok: false; error: string }
        >("zarr_load_mask_frame", { request });
        if (!result.ok) return result;
        return { ...result, data: normalizeArrayBuffer(result.data, "u32") };
      },
      pickMasksDirectory: () => invoke("zarr_pick_masks_dir"),
    },
    tasks: {
      pickCropsDestination: () => invoke("tasks_pick_crops_destination"),
      pickExpressionOutput: (suggestedPath?: string) =>
        invoke("tasks_pick_expression_output", { payload: { suggestedPath } }),
      pickTissueModel: () => invoke("tasks_pick_tissue_model"),
      pickTissueOutput: (suggestedPath?: string) =>
        invoke("tasks_pick_tissue_output", { payload: { suggestedPath } }),
      pickKillModel: () => invoke("tasks_pick_kill_model"),
      pickMovieOutput: () => invoke("tasks_pick_movie_output"),
      pickSpotsFile: () => invoke("tasks_pick_spots_file"),
      pickND2Input: () => invoke("tasks_pick_nd2_input"),
      pickConvertOutput: () => invoke("tasks_pick_convert_output"),
      hasBboxCsv: (payload) => invoke("tasks_has_bbox_csv", { payload }),
      startCrop: (payload) => invoke("tasks_start_crop", { payload }),
      runCrop: (payload) => invoke("tasks_run_crop", { payload }),
      onCropProgress: (callback) =>
        subscribeProgress("tasks:crop-progress", callback),
      startConvert: (payload) => invoke("tasks_start_convert", { payload }),
      runConvert: (payload) => invoke("tasks_run_convert", { payload }),
      onConvertProgress: (callback) =>
        subscribeProgress("tasks:convert-progress", callback),
      startExpressionAnalyze: (payload) =>
        invoke("tasks_start_expression_analyze", { payload }),
      runExpressionAnalyze: async (payload) => {
        const result = await invoke<
          | { ok: true; output: string; rows: ExpressionRow[] }
          | { ok: false; error: string }
        >("tasks_run_expression_analyze", { payload });
        if (!result.ok) return result;
        const built = buildExpressionDataset(result.rows);
        return {
          ok: true as const,
          output: result.output,
          datasetId: built.datasetId,
          series: built.series,
          metrics: built.metrics,
        };
      },
      onExpressionAnalyzeProgress: (callback) =>
        subscribeProgress("tasks:expression-analyze-progress", callback),
      startTissueAnalyze: (payload) => invoke("tasks_start_tissue_analyze", { payload }),
      runTissueAnalyze: (payload) => invoke("tasks_run_tissue_analyze", { payload }),
      onTissueAnalyzeProgress: (callback) =>
        subscribeProgress("tasks:tissue-analyze-progress", callback),
      startKillPredict: (payload) => invoke("tasks_start_kill_predict", { payload }),
      runKillPredict: (payload) => invoke("tasks_run_kill_predict", { payload }),
      onKillPredictProgress: (callback) =>
        subscribeProgress("tasks:kill-predict-progress", callback),
      startMovie: (payload) => invoke("tasks_start_movie", { payload }),
      runMovie: (payload) => invoke("tasks_run_movie", { payload }),
      onMovieProgress: (callback) =>
        subscribeProgress("tasks:movie-progress", callback),
      insertTask: (task) => invoke("tasks_insert_task", { task }),
      updateTask: (id, updates) => invoke("tasks_update_task", { payload: { id, updates } }),
      listTasks: () => invoke("tasks_list_tasks"),
      deleteCompletedTasks: () => invoke("tasks_delete_completed_tasks"),
    },
    application: {
      listExpressionCsv: (workspacePath: string) =>
        invoke("application_list_expression_csv", { payload: { workspacePath } }),
      loadExpressionCsv: async (path: string) => {
        const result = await invoke<
          | { ok: true; rows: ExpressionRow[] }
          | { ok: false; error: string }
        >("application_load_expression_csv", { payload: { csvPath: path } });
        if (!result.ok) return result;
        const built = buildExpressionDataset(result.rows);
        return {
          ok: true as const,
          datasetId: built.datasetId,
          series: built.series,
          metrics: built.metrics,
        };
      },
      filterExpression: async (payload) => {
        const dataset = expressionDatasets.get(payload.datasetId);
        if (!dataset) return { ok: false as const, error: "Expression dataset not found." };

        let dropCount = 0;
        const selected: string[] = [];
        for (const metric of dataset.metrics) {
          const drop = isDropTrace(
            metric,
            payload.logReturnThreshold,
            payload.minConsecutive,
          );
          if (drop) dropCount += 1;
          if (payload.hideFlat && metric.flatnessScore <= payload.flatnessThreshold) continue;
          if (payload.hideDrop && drop) continue;
          selected.push(metric.crop);
        }
        selected.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return {
          ok: true as const,
          selectedCrops: selected,
          totalCount: dataset.metrics.length,
          dropCount,
        };
      },
      releaseExpressionDataset: async (datasetId: string) => {
        expressionDatasets.delete(datasetId);
        return true;
      },
      listKillCsv: (workspacePath: string) =>
        invoke("application_list_kill_csv", { payload: { workspacePath } }),
      loadKillCsv: (path: string) =>
        invoke("application_load_kill_csv", { payload: { csvPath: path } }),
      listTissueCsv: (workspacePath: string) =>
        invoke("application_list_tissue_csv", { payload: { workspacePath } }),
      loadTissueCsv: (path: string) =>
        invoke("application_load_tissue_csv", { payload: { csvPath: path } }),
    },
  };
}

ensureBridge();

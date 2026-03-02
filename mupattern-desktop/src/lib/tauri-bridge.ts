import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

const unsupported = async (name: string) => {
  throw new Error(`${name} is not implemented in tauri backend yet`);
};

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
        const selected = await open({ directory: true, multiple: false });
        if (!selected || Array.isArray(selected)) return null;
        const parts = selected.split(/[\\/]/);
        const name = parts[parts.length - 1] ?? selected;
        return { path: selected, name, positions: [], channels: [], times: [], zSlices: [] };
      },
      pathExists: () => unsupported("workspace.pathExists"),
      rescanDirectory: () => unsupported("workspace.rescanDirectory"),
      pickTagsFile: async () => {
        const selected = await open({ multiple: false, filters: [{ name: "Tags", extensions: ["yaml", "yml", "txt"] }] });
        return !selected || Array.isArray(selected) ? null : selected;
      },
      readPositionImage: () => unsupported("workspace.readPositionImage"),
      saveBboxCsv: () => unsupported("workspace.saveBboxCsv"),
    },
    zarr: {
      discover: () => unsupported("zarr.discover"),
      loadFrame: () => unsupported("zarr.loadFrame"),
      hasMasks: () => unsupported("zarr.hasMasks"),
      loadMaskFrame: () => unsupported("zarr.loadMaskFrame"),
      pickMasksDirectory: async () => {
        const selected = await open({ directory: true, multiple: false });
        return !selected || Array.isArray(selected) ? null : { path: selected };
      },
    },
    tasks: {
      pickCropsDestination: async () => {
        const selected = await open({ directory: true, multiple: false });
        return !selected || Array.isArray(selected) ? null : { path: selected };
      },
      pickExpressionOutput: async (suggestedPath?: string) => {
        const selected = await save({ defaultPath: suggestedPath });
        return selected ? { path: selected } : null;
      },
      pickTissueModel: () => unsupported("tasks.pickTissueModel"),
      pickTissueOutput: async (suggestedPath?: string) => {
        const selected = await save({ defaultPath: suggestedPath });
        return selected ? { path: selected } : null;
      },
      pickKillModel: () => unsupported("tasks.pickKillModel"),
      pickMovieOutput: async () => unsupported("tasks.pickMovieOutput"),
      pickSpotsFile: () => unsupported("tasks.pickSpotsFile"),
      pickND2Input: () => unsupported("tasks.pickND2Input"),
      pickConvertOutput: async () => {
        const selected = await open({ directory: true, multiple: false });
        return !selected || Array.isArray(selected) ? null : { path: selected };
      },
      hasBboxCsv: () => unsupported("tasks.hasBboxCsv"),
      runCrop: () => unsupported("tasks.runCrop"),
      onCropProgress: () => () => {},
      runConvert: (payload) => invoke("tasks_run_convert", { payload }) as Promise<{ ok: true } | { ok: false; error: string }>,
      onConvertProgress: (callback) => {
        let unlisten: (() => void) | null = null;
        void listen<{ progress: number; message: string }>("tasks:convert-progress", (event) => {
          callback({ taskId: "", progress: event.payload.progress, message: event.payload.message });
        }).then((fn) => {
          unlisten = fn;
        });
        return () => unlisten?.();
      },
      runExpressionAnalyze: () => unsupported("tasks.runExpressionAnalyze"),
      onExpressionAnalyzeProgress: () => () => {},
      runTissueAnalyze: () => unsupported("tasks.runTissueAnalyze"),
      onTissueAnalyzeProgress: () => () => {},
      runKillPredict: () => unsupported("tasks.runKillPredict"),
      onKillPredictProgress: () => () => {},
      runMovie: () => unsupported("tasks.runMovie"),
      onMovieProgress: () => () => {},
      insertTask: async () => true,
      updateTask: async () => true,
      listTasks: async () => [],
      deleteCompletedTasks: async () => true,
    },
    application: {
      listExpressionCsv: () => unsupported("application.listExpressionCsv"),
      loadExpressionCsv: () => unsupported("application.loadExpressionCsv"),
      filterExpression: () => unsupported("application.filterExpression"),
      releaseExpressionDataset: async () => true,
      listKillCsv: () => unsupported("application.listKillCsv"),
      loadKillCsv: () => unsupported("application.loadKillCsv"),
      listTissueCsv: () => unsupported("application.listTissueCsv"),
      loadTissueCsv: () => unsupported("application.loadTissueCsv"),
    },
  };
}

ensureBridge();

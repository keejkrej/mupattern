export {};

interface WorkspaceSnapshot {
  workspaces: Array<{
    id: string;
    name: string;
    rootPath?: string;
    positions: number[];
    posTags?: Array<{
      id: string;
      label: string;
      startIndex: number;
      endIndex: number;
    }>;
    positionFilterLabel?: string | null;
    positionFilterLabels?: string[];
    channels: number[];
    times: number[];
    zSlices: number[];
    selectedChannel: number;
    selectedTime: number;
    selectedZ: number;
    currentIndex: number;
  }>;
  activeId: string | null;
}

interface WorkspacePickResult {
  path: string;
  name: string;
  positions: number[];
  channels: number[];
  times: number[];
  zSlices: number[];
}

interface WorkspaceReadPositionImageRequest {
  workspacePath: string;
  pos: number;
  channel: number;
  time: number;
  z: number;
}

interface WorkspaceReadPositionImageSuccess {
  ok: true;
  baseName: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

interface WorkspaceReadPositionImageFailure {
  ok: false;
  error: string;
}

type WorkspaceReadPositionImageResponse =
  | WorkspaceReadPositionImageSuccess
  | WorkspaceReadPositionImageFailure;

interface WorkspaceSaveBboxCsvRequest {
  workspacePath: string;
  pos: number;
  csv: string;
}

interface ZarrDiscoverRequest {
  workspacePath: string;
  positionFilter?: string[];
  metadataMode?: "full" | "fast";
}

interface ZarrDiscoverResponse {
  positions: string[];
  crops: Record<string, Array<{ posId: string; cropId: string; shape: number[] }>>;
}

interface ZarrLoadFrameRequest {
  workspacePath: string;
  posId: string;
  cropId: string;
  t: number;
  c: number;
  z: number;
}

interface ZarrLoadFrameSuccess {
  ok: true;
  width: number;
  height: number;
  data: ArrayBuffer;
}

interface ZarrLoadFrameFailure {
  ok: false;
  error: string;
}

type ZarrLoadFrameResponse = ZarrLoadFrameSuccess | ZarrLoadFrameFailure;

interface ZarrHasMasksRequest {
  masksPath: string;
}

interface ZarrHasMasksResponse {
  hasMasks: boolean;
}

interface ZarrLoadMaskFrameRequest {
  masksPath: string;
  posId: string;
  cropId: string;
  t: number;
}

interface ZarrLoadMaskFrameSuccess {
  ok: true;
  width: number;
  height: number;
  data: ArrayBuffer;
}

interface ZarrLoadMaskFrameFailure {
  ok: false;
  error: string;
}

type ZarrLoadMaskFrameResponse = ZarrLoadMaskFrameSuccess | ZarrLoadMaskFrameFailure;

declare global {
  interface Window {
    mupatternDesktop: {
      platform: string;
      workspaceState: {
        load: () => Promise<WorkspaceSnapshot | null>;
        save: (state: WorkspaceSnapshot) => Promise<boolean>;
      };
      workspace: {
        pickDirectory: () => Promise<WorkspacePickResult | null>;
        pathExists: (path: string) => Promise<boolean>;
        rescanDirectory: (path: string) => Promise<WorkspacePickResult | null>;
        pickTagsFile: () => Promise<string | null>;
        readPositionImage: (
          request: WorkspaceReadPositionImageRequest,
        ) => Promise<WorkspaceReadPositionImageResponse>;
        saveBboxCsv: (request: WorkspaceSaveBboxCsvRequest) => Promise<boolean>;
      };
      zarr: {
        discover: (request: ZarrDiscoverRequest) => Promise<ZarrDiscoverResponse>;
        loadFrame: (request: ZarrLoadFrameRequest) => Promise<ZarrLoadFrameResponse>;
        hasMasks: (request: ZarrHasMasksRequest) => Promise<ZarrHasMasksResponse>;
        loadMaskFrame: (request: ZarrLoadMaskFrameRequest) => Promise<ZarrLoadMaskFrameResponse>;
        pickMasksDirectory: () => Promise<{ path: string } | null>;
      };
      tasks: {
        pickCropsDestination: () => Promise<{ path: string } | null>;
        pickExpressionOutput: (suggestedPath?: string) => Promise<{ path: string } | null>;
        pickTissueModel: () => Promise<{ path: string } | null>;
        pickTissueOutput: (suggestedPath?: string) => Promise<{ path: string } | null>;
        pickKillModel: () => Promise<{ path: string } | null>;
        pickMovieOutput: () => Promise<{ path: string } | null>;
        pickSpotsFile: () => Promise<{ path: string } | null>;
        pickND2Input: () => Promise<{ path: string } | null>;
        pickConvertOutput: () => Promise<{ path: string } | null>;
        hasBboxCsv: (payload: { workspacePath: string; pos: number }) => Promise<boolean>;
        runCrop: (payload: {
          taskId: string;
          input_dir: string;
          pos: number;
          bbox: string;
          output: string;
          background: boolean;
        }) => Promise<{ ok: true } | { ok: false; error: string }>;
        onCropProgress: (
          callback: (ev: { taskId: string; progress: number; message: string }) => void,
        ) => () => void;
        runConvert: (payload: {
          taskId: string;
          input: string;
          output: string;
          pos: string;
          time: string;
        }) => Promise<{ ok: true } | { ok: false; error: string }>;
        onConvertProgress: (
          callback: (ev: { taskId: string; progress: number; message: string }) => void,
        ) => () => void;
        runExpressionAnalyze: (payload: {
          taskId: string;
          workspacePath: string;
          pos: number;
          channel: number;
          output: string;
        }) => Promise<
          | {
              ok: true;
              output: string;
              rows: Array<{
                t: number;
                crop: string;
                intensity: number;
                area: number;
                background: number;
              }>;
            }
          | { ok: false; error: string }
        >;
        onExpressionAnalyzeProgress: (
          callback: (ev: { taskId: string; progress: number; message: string }) => void,
        ) => () => void;
        runTissueAnalyze: (payload: {
          taskId: string;
          workspacePath: string;
          pos: number;
          channelPhase: number;
          channelFluorescence: number;
          method: string;
          model: string;
          output: string;
        }) => Promise<
          | {
              ok: true;
              output: string;
              rows: Array<{
                t: number;
                crop: string;
                cell: number;
                total_fluorescence: number;
                cell_area: number;
                background: number;
              }>;
            }
          | { ok: false; error: string }
        >;
        onTissueAnalyzeProgress: (
          callback: (ev: { taskId: string; progress: number; message: string }) => void,
        ) => () => void;
        runKillPredict: (payload: {
          taskId: string;
          workspacePath: string;
          pos: number;
          modelPath: string;
          output: string;
          batchSize?: number;
        }) => Promise<
          | { ok: true; output: string; rows: Array<{ t: number; crop: string; label: boolean }> }
          | { ok: false; error: string }
        >;
        onKillPredictProgress: (
          callback: (ev: { taskId: string; progress: number; message: string }) => void,
        ) => () => void;
        runMovie: (payload: {
          taskId: string;
          input_zarr: string;
          pos: number;
          crop: number;
          channel: number;
          time: string;
          output: string;
          fps: number;
          colormap: string;
          spots: string | null;
        }) => Promise<{ ok: true } | { ok: false; error: string }>;
        onMovieProgress: (
          callback: (ev: { taskId: string; progress: number; message: string }) => void,
        ) => () => void;
        insertTask: (task: unknown) => Promise<boolean>;
        updateTask: (id: string, updates: unknown) => Promise<boolean>;
        listTasks: () => Promise<unknown[]>;
        deleteCompletedTasks: () => Promise<boolean>;
      };
      application: {
        listExpressionCsv: (
          workspacePath: string,
        ) => Promise<Array<{ posId: string; path: string }>>;
        loadExpressionCsv: (path: string) => Promise<
          | {
              ok: true;
              rows: Array<{
                t: number;
                crop: string;
                intensity: number;
                area: number;
                background: number;
              }>;
            }
          | { ok: false; error: string }
        >;
        listKillCsv: (workspacePath: string) => Promise<
          Array<{ posId: string; path: string }>
        >;
        loadKillCsv: (path: string) => Promise<
          | { ok: true; rows: Array<{ t: number; crop: string; label: boolean }> }
          | { ok: false; error: string }
        >;
        listTissueCsv: (workspacePath: string) => Promise<
          Array<{ posId: string; path: string }>
        >;
        loadTissueCsv: (path: string) => Promise<
          | {
              ok: true;
              rows: Array<{
                t: number;
                crop: string;
                cell: number;
                total_fluorescence: number;
                cell_area: number;
                background: number;
              }>;
            }
          | { ok: false; error: string }
        >;
      };
    };
  }
}

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
      };
      tasks: {
        pickCropsDestination: () => Promise<{ path: string } | null>;
        pickKillOutput: (suggestedPath?: string) => Promise<{ path: string } | null>;
        pickKillModel: () => Promise<{ path: string } | null>;
        pickMovieOutput: () => Promise<{ path: string } | null>;
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
        listKillCsv: (workspacePath: string) => Promise<Array<{ posId: string; path: string }>>;
        loadKillCsv: (path: string) => Promise<
          | { ok: true; rows: Array<{ t: number; crop: string; label: boolean }> }
          | { ok: false; error: string }
        >;
      };
    };
  }
}

export {}

interface WorkspaceSnapshot {
  workspaces: Array<{
    id: string
    name: string
    rootPath?: string
    positions: number[]
    posTags?: Array<{
      id: string
      label: string
      startIndex: number
      endIndex: number
    }>
    positionFilterLabel?: string | null
    positionFilterLabels?: string[]
    channels: number[]
    times: number[]
    zSlices: number[]
    selectedChannel: number
    selectedTime: number
    selectedZ: number
    currentIndex: number
  }>
  activeId: string | null
}

interface WorkspacePickResult {
  path: string
  name: string
  positions: number[]
  channels: number[]
  times: number[]
  zSlices: number[]
}

interface WorkspaceReadPositionImageRequest {
  workspacePath: string
  pos: number
  channel: number
  time: number
  z: number
}

interface WorkspaceReadPositionImageSuccess {
  ok: true
  baseName: string
  width: number
  height: number
  rgba: ArrayBuffer
}

interface WorkspaceReadPositionImageFailure {
  ok: false
  error: string
}

type WorkspaceReadPositionImageResponse =
  | WorkspaceReadPositionImageSuccess
  | WorkspaceReadPositionImageFailure

interface WorkspaceSaveBboxCsvRequest {
  workspacePath: string
  pos: number
  csv: string
}

interface ZarrDiscoverRequest {
  workspacePath: string
  positionFilter?: string[]
  metadataMode?: "full" | "fast"
}

interface ZarrDiscoverResponse {
  positions: string[]
  crops: Record<string, Array<{ posId: string; cropId: string; shape: number[] }>>
}

interface ZarrLoadFrameRequest {
  workspacePath: string
  posId: string
  cropId: string
  t: number
  c: number
  z: number
}

interface ZarrLoadFrameSuccess {
  ok: true
  width: number
  height: number
  data: ArrayBuffer
}

interface ZarrLoadFrameFailure {
  ok: false
  error: string
}

type ZarrLoadFrameResponse = ZarrLoadFrameSuccess | ZarrLoadFrameFailure

declare global {
  interface Window {
    mustudio: {
      platform: string
      workspaceState: {
        load: () => Promise<WorkspaceSnapshot | null>
        save: (state: WorkspaceSnapshot) => Promise<boolean>
      }
      workspace: {
        pickDirectory: () => Promise<WorkspacePickResult | null>
        readPositionImage: (
          request: WorkspaceReadPositionImageRequest
        ) => Promise<WorkspaceReadPositionImageResponse>
        saveBboxCsv: (request: WorkspaceSaveBboxCsvRequest) => Promise<boolean>
      }
      zarr: {
        discover: (request: ZarrDiscoverRequest) => Promise<ZarrDiscoverResponse>
        loadFrame: (request: ZarrLoadFrameRequest) => Promise<ZarrLoadFrameResponse>
      }
    }
  }
}

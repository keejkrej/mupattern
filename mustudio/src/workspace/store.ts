import { Store } from "@tanstack/store"

/** Single workspace backed by a parent folder with Pos{N}/ subdirectories. */
export interface PositionTag {
  id: string
  label: string
  startIndex: number
  endIndex: number
}

export interface Workspace {
  id: string
  name: string
  rootPath: string
  positions: number[]
  posTags: PositionTag[]
  positionFilterLabels: string[]
  channels: number[]
  times: number[]
  zSlices: number[]
  selectedChannel: number
  selectedTime: number
  selectedZ: number
  currentIndex: number
}

export interface WorkspaceStoreState {
  workspaces: Workspace[]
  activeId: string | null
}

const DEFAULT_STATE: WorkspaceStoreState = { workspaces: [], activeId: null }
let hasHydratedWorkspaceState = false

function getWorkspaceStateApi() {
  if (typeof window !== "undefined" && window.mustudio?.workspaceState) {
    return window.mustudio.workspaceState
  }
  return {
    load: async (): Promise<WorkspaceStoreState | null> => null,
    save: async (): Promise<boolean> => false,
  }
}

function isWorkspaceStoreState(value: unknown): value is WorkspaceStoreState {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return Array.isArray(candidate.workspaces) && ("activeId" in candidate)
}

function parsePosFolderName(posName: string): number | null {
  const m = posName.match(/^Pos(\d+)$/i)
  return m ? parseInt(m[1], 10) : null
}

function normalizePositionValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  if (typeof value === "string") {
    const parsedFolder = parsePosFolderName(value)
    if (parsedFolder != null) return parsedFolder
    if (/^\d+$/.test(value)) return parseInt(value, 10)
  }
  return null
}

function normalizeWorkspace(workspace: Workspace): Workspace {
  const rootPath = typeof workspace.rootPath === "string" ? workspace.rootPath : ""
  const positionsFromState = Array.isArray(workspace.positions)
    ? workspace.positions.map((value) => normalizePositionValue(value)).filter((value): value is number => value != null)
    : []
  const positions = positionsFromState
  const normalizedMaxIndex = Math.max(0, positions.length - 1)
  const posTags = Array.isArray(workspace.posTags)
    ? workspace.posTags
      .map((tag) => {
        const label = String(tag.label ?? "").trim()
        if (!label) return null
        let startIndex = Math.max(0, Math.min(tag.startIndex, normalizedMaxIndex))
        let endIndex = Math.max(0, Math.min(tag.endIndex, normalizedMaxIndex))
        if (startIndex > endIndex) {
          const tmp = startIndex
          startIndex = endIndex
          endIndex = tmp
        }
        return {
          id: String(tag.id ?? crypto.randomUUID()),
          label,
          startIndex,
          endIndex,
        }
      })
      .filter((tag): tag is PositionTag => tag !== null)
    : []

  const positionFilterLabelsRaw = (() => {
    const legacy = (workspace as unknown as Record<string, unknown>).positionFilterLabel
    if (typeof legacy === "string" && legacy.trim()) return [legacy.trim()]
    const next = (workspace as unknown as Record<string, unknown>).positionFilterLabels
    if (Array.isArray(next)) return next.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0)
    return []
  })()
  const tagLabelSet = new Set(posTags.map((tag) => tag.label))
  const positionFilterLabels = [...new Set(positionFilterLabelsRaw)].filter((label) => tagLabelSet.has(label))

  return {
    ...workspace,
    rootPath,
    positions,
    posTags,
    positionFilterLabels,
    currentIndex: Math.max(0, Math.min(workspace.currentIndex, normalizedMaxIndex)),
  }
}

const workspaceStateApi = getWorkspaceStateApi()

export const workspaceStore = new Store<WorkspaceStoreState>(DEFAULT_STATE)

async function hydrateWorkspaceStoreFromDisk(): Promise<void> {
  try {
    const saved = await workspaceStateApi.load()
    if (saved && isWorkspaceStoreState(saved)) {
      // Always start on the workspace landing/list screen after app restart.
      workspaceStore.setState({
        ...saved,
        workspaces: saved.workspaces.map((workspace) => normalizeWorkspace(workspace)),
        activeId: null,
      })
    }
  } catch {
    // ignore disk read failures
  } finally {
    hasHydratedWorkspaceState = true
  }
}

void hydrateWorkspaceStoreFromDisk()

async function persistWorkspaceStateToDisk(state: WorkspaceStoreState): Promise<void> {
  try {
    await workspaceStateApi.save(state)
  } catch {
    // ignore disk write failures
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
workspaceStore.subscribe(() => {
  if (!hasHydratedWorkspaceState) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void persistWorkspaceStateToDisk(workspaceStore.state)
  }, 1200)
})

// --- Filename builder (mufile convert format) ---

/** Format: img_channel{C:03d}_position{P:03d}_time{T:09d}_z{Z:03d}.tif */
export function buildTifFilename(posNum: number, channel: number, time: number, z: number): string {
  return `img_channel${String(channel).padStart(3, "0")}_position${String(posNum).padStart(3, "0")}_time${String(time).padStart(9, "0")}_z${String(z).padStart(3, "0")}.tif`
}

export function posDirName(pos: number): string {
  return `Pos${pos}`
}

// --- Actions ---

export function addWorkspace(workspace: Workspace) {
  const normalizedWorkspace = normalizeWorkspace(workspace)
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: [...s.workspaces, normalizedWorkspace],
    activeId: normalizedWorkspace.id,
  }))
}

export function removeWorkspace(workspaceId: string) {
  workspaceStore.setState((s) => ({
    workspaces: s.workspaces.filter((w) => w.id !== workspaceId),
    activeId: s.activeId === workspaceId ? null : s.activeId,
  }))
}

export function setActiveWorkspace(workspaceId: string | null) {
  workspaceStore.setState((s) => ({ ...s, activeId: workspaceId }))
}

export function setSelectedChannel(workspaceId: string, value: number) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, selectedChannel: value } : w
    ),
  }))
}

export function setSelectedTime(workspaceId: string, value: number) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, selectedTime: value } : w
    ),
  }))
}

export function setSelectedZ(workspaceId: string, value: number) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, selectedZ: value } : w
    ),
  }))
}

export function setCurrentIndex(workspaceId: string, index: number) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      const max = w.positions.length - 1
      const nextIndex = Math.max(0, Math.min(index, max))
      const visible = getWorkspaceVisiblePositionIndices(w)
      if (visible.length > 0 && !visible.includes(nextIndex)) {
        return { ...w, currentIndex: visible[0] }
      }
      return { ...w, currentIndex: nextIndex }
    }),
  }))
}

export function nextPosition(workspaceId: string) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      const visible = getWorkspaceVisiblePositionIndices(w)
      if (visible.length === 0) return w
      const currentVisible = visible.indexOf(w.currentIndex)
      if (currentVisible < 0) return { ...w, currentIndex: visible[0] }
      const nextVisible = Math.min(currentVisible + 1, visible.length - 1)
      return { ...w, currentIndex: visible[nextVisible] }
    }),
  }))
}

export function prevPosition(workspaceId: string) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      const visible = getWorkspaceVisiblePositionIndices(w)
      if (visible.length === 0) return w
      const currentVisible = visible.indexOf(w.currentIndex)
      if (currentVisible < 0) return { ...w, currentIndex: visible[0] }
      const prevVisible = Math.max(currentVisible - 1, 0)
      return { ...w, currentIndex: visible[prevVisible] }
    }),
  }))
}

export function addPositionTag(workspaceId: string, label: string, startIndex: number, endIndex: number) {
  const cleanedLabel = label.trim()
  if (!cleanedLabel) return
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      const maxIndex = w.positions.length - 1
      if (maxIndex < 0) return w
      let start = Math.max(0, Math.min(startIndex, maxIndex))
      let end = Math.max(0, Math.min(endIndex, maxIndex))
      if (start > end) {
        const tmp = start
        start = end
        end = tmp
      }
      return {
        ...w,
        posTags: [
          ...w.posTags,
          { id: crypto.randomUUID(), label: cleanedLabel, startIndex: start, endIndex: end },
        ],
      }
    }),
  }))
}

export function removePositionTag(workspaceId: string, tagId: string) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      const posTags = w.posTags.filter((tag) => tag.id !== tagId)
      const allowed = new Set(posTags.map((tag) => tag.label))
      const positionFilterLabels = w.positionFilterLabels.filter((label) => allowed.has(label))
      const next = { ...w, posTags, positionFilterLabels }
      const visible = getWorkspaceVisiblePositionIndices(next)
      if (visible.length > 0 && !visible.includes(next.currentIndex)) {
        return { ...next, currentIndex: visible[0] }
      }
      return next
    }),
  }))
}

export function togglePositionTagFilter(workspaceId: string, label: string) {
  const target = label.trim()
  if (!target) return
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      if (!w.posTags.some((tag) => tag.label === target)) return w
      const already = w.positionFilterLabels.includes(target)
      const positionFilterLabels = already
        ? w.positionFilterLabels.filter((v) => v !== target)
        : [...w.positionFilterLabels, target]
      const next = { ...w, positionFilterLabels }
      const visible = getWorkspaceVisiblePositionIndices(next)
      if (visible.length > 0 && !visible.includes(next.currentIndex)) {
        return { ...next, currentIndex: visible[0] }
      }
      return next
    }),
  }))
}

export function clearPositionTagFilters(workspaceId: string) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, positionFilterLabels: [] } : w
    ),
  }))
}

export function getWorkspaceVisiblePositionIndices(workspace: Workspace): number[] {
  const allIndices = workspace.positions.map((_, i) => i)
  const filterLabels = workspace.positionFilterLabels
  if (filterLabels.length === 0) return allIndices
  const uniqueFilterLabels = [...new Set(filterLabels)]

  const visible = allIndices.filter((index) =>
    uniqueFilterLabels.every((label) =>
      workspace.posTags.some(
        (tag) =>
          tag.label === label &&
          index >= tag.startIndex &&
          index <= tag.endIndex
      )
    )
  )
  return visible
}

// --- Helpers ---

export function getActiveWorkspace(): Workspace | null {
  const { activeId, workspaces } = workspaceStore.state
  if (!activeId) return null
  return workspaces.find((w) => w.id === activeId) ?? null
}

export function hasWorkspace(): boolean {
  return getActiveWorkspace() !== null
}

export interface LoadedWorkspaceImage {
  src: string
  baseName: string
  width: number
  height: number
}

async function rgbaToObjectUrl(
  rgba: ArrayBuffer,
  width: number,
  height: number
): Promise<string> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas context unavailable")
  const pixels = new Uint8ClampedArray(rgba)
  const imageData = new ImageData(pixels, width, height)
  ctx.putImageData(imageData, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error("Failed to encode image"))
    }, "image/png")
  })
  return URL.createObjectURL(blob)
}

/** Read and decode a TIF for the given position using Electron main process I/O. */
export async function readPositionImage(posNum: number): Promise<LoadedWorkspaceImage | null> {
  const ws = getActiveWorkspace()
  if (!ws) return null
  if (!ws.rootPath) return null

  try {
    const result = await window.mustudio.workspace.readPositionImage({
      workspacePath: ws.rootPath,
      pos: posNum,
      channel: ws.selectedChannel,
      time: ws.selectedTime,
      z: ws.selectedZ,
    })
    if (!result.ok) return null
    const src = await rgbaToObjectUrl(result.rgba, result.width, result.height)
    return {
      src,
      baseName: result.baseName,
      width: result.width,
      height: result.height,
    }
  } catch {
    return null
  }
}

/** Read the TIF for the active workspace's current position (positions[currentIndex]). */
export async function readCurrentPositionImage(): Promise<LoadedWorkspaceImage | null> {
  const ws = getActiveWorkspace()
  if (!ws || ws.positions.length === 0) return null
  const pos = ws.positions[ws.currentIndex]
  return readPositionImage(pos)
}

export async function saveWorkspaceBboxCsv(
  workspaceId: string,
  pos: number,
  csv: string
): Promise<boolean> {
  const ws = workspaceStore.state.workspaces.find((workspace) => workspace.id === workspaceId)
  if (!ws || !ws.rootPath) return false
  try {
    return await window.mustudio.workspace.saveBboxCsv({
      workspacePath: ws.rootPath,
      pos,
      csv,
    })
  } catch {
    return false
  }
}

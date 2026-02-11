import { Store } from "@tanstack/store"
import { saveHandle, loadHandle, clearHandle } from "@/lib/idb-handle"

/** Single workspace backed by a parent folder with Pos{N}/ subdirectories. */
export interface Workspace {
  id: string
  name: string
  positions: string[]
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

const STORAGE_KEY = "mupattern-workspaces"
const IDB_PREFIX = "mupattern-ws-"

function loadFromStorage(): WorkspaceStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return { workspaces: [], activeId: null }
}

function saveToStorage(state: WorkspaceStoreState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export const workspaceStore = new Store<WorkspaceStoreState>(
  loadFromStorage()
)

let timer: ReturnType<typeof setTimeout> | null = null
workspaceStore.subscribe(() => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => saveToStorage(workspaceStore.state), 300)
})

// --- In-memory directory handle cache ---

const _handleCache = new Map<string, FileSystemDirectoryHandle>()

function idbKey(workspaceId: string): string {
  return `${IDB_PREFIX}${workspaceId}`
}

export function getDirHandle(workspaceId: string): FileSystemDirectoryHandle | null {
  return _handleCache.get(workspaceId) ?? null
}

export async function persistDirHandle(workspaceId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  _handleCache.set(workspaceId, handle)
  await saveHandle(idbKey(workspaceId), handle)
}

export async function restoreDirHandle(workspaceId: string): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadHandle(idbKey(workspaceId))
  if (handle) {
    _handleCache.set(workspaceId, handle)
  }
  return handle
}

async function removeDirHandle(workspaceId: string): Promise<void> {
  _handleCache.delete(workspaceId)
  await clearHandle(idbKey(workspaceId))
}

// --- Filename builder (mufile convert format) ---

/** Format: img_channel{C:03d}_position{P:03d}_time{T:09d}_z{Z:03d}.tif */
export function buildTifFilename(posNum: number, channel: number, time: number, z: number): string {
  return `img_channel${String(channel).padStart(3, "0")}_position${String(posNum).padStart(3, "0")}_time${String(time).padStart(9, "0")}_z${String(z).padStart(3, "0")}.tif`
}

/** Parse position folder name (e.g. "Pos140") -> number (e.g. 140). */
function parsePosNum(posName: string): number {
  const m = posName.match(/^Pos(\d+)$/i)
  return m ? parseInt(m[1], 10) : 0
}

// --- Actions ---

export function addWorkspace(workspace: Workspace, dirHandle: FileSystemDirectoryHandle) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: [...s.workspaces, workspace],
    activeId: workspace.id,
  }))
  persistDirHandle(workspace.id, dirHandle)
}

export function removeWorkspace(workspaceId: string) {
  workspaceStore.setState((s) => ({
    workspaces: s.workspaces.filter((w) => w.id !== workspaceId),
    activeId: s.activeId === workspaceId ? null : s.activeId,
  }))
  removeDirHandle(workspaceId)
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
      return { ...w, currentIndex: Math.max(0, Math.min(index, max)) }
    }),
  }))
}

export function nextPosition(workspaceId: string) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      const next = Math.min(w.currentIndex + 1, w.positions.length - 1)
      return { ...w, currentIndex: next }
    }),
  }))
}

export function prevPosition(workspaceId: string) {
  workspaceStore.setState((s) => ({
    ...s,
    workspaces: s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w
      const prev = Math.max(w.currentIndex - 1, 0)
      return { ...w, currentIndex: prev }
    }),
  }))
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

/** Read a TIF file for the given position folder name, using the active workspace's dimension selections. */
export async function readPositionImage(posName: string): Promise<File | null> {
  const ws = getActiveWorkspace()
  if (!ws) return null

  const dirHandle = getDirHandle(ws.id)
  if (!dirHandle) return null

  try {
    const posHandle = await dirHandle.getDirectoryHandle(posName)
    const posNum = parsePosNum(posName)
    const filename = buildTifFilename(
      posNum,
      ws.selectedChannel,
      ws.selectedTime,
      ws.selectedZ
    )
    const fileHandle = await posHandle.getFileHandle(filename)
    return await fileHandle.getFile()
  } catch {
    return null
  }
}

/** Read the TIF for the active workspace's current position (positions[currentIndex]). */
export async function readCurrentPositionImage(): Promise<File | null> {
  const ws = getActiveWorkspace()
  if (!ws || ws.positions.length === 0) return null
  const posName = ws.positions[ws.currentIndex]
  return readPositionImage(posName)
}

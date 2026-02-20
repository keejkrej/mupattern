import type { ImageSource } from "@/register/store"
import { clearDetectedPoints, startWithImage } from "@/register/store"
import {
  readPositionImage,
  setActiveWorkspace,
  setCurrentIndex,
  setSelectedChannel,
  setSelectedTime,
  setSelectedZ,
  workspaceStore,
} from "@/workspace/store"

export async function reloadActiveWorkspaceImage(): Promise<{ ok: true; source: ImageSource } | { ok: false; error: string }> {
  const ws = workspaceStore.state.workspaces.find((w) => w.id === workspaceStore.state.activeId)
  if (!ws || ws.positions.length === 0) {
    return { ok: false, error: "No workspace selected." }
  }
  const pos = ws.positions[ws.currentIndex]
  const loaded = await readPositionImage(pos)
  if (!loaded) {
    return { ok: false, error: "Could not read selected file. Try a different position/channel/time/z." }
  }
  const source: ImageSource = {
    workspaceId: ws.id,
    position: pos,
    channel: ws.selectedChannel,
    time: ws.selectedTime,
    z: ws.selectedZ,
  }
  startWithImage(loaded.src, loaded.baseName, loaded.width, loaded.height, source)
  clearDetectedPoints()
  return { ok: true, source }
}

export async function loadImageFromSource(source: ImageSource): Promise<{ ok: true } | { ok: false; error: string }> {
  const ws = workspaceStore.state.workspaces.find((w) => w.id === source.workspaceId)
  if (!ws || !ws.rootPath) {
    return { ok: false, error: "Workspace not found. It may have been removed." }
  }
  const posIndex = ws.positions.indexOf(source.position)
  if (posIndex < 0) {
    return { ok: false, error: "Position no longer exists in workspace." }
  }
  setActiveWorkspace(source.workspaceId)
  setCurrentIndex(source.workspaceId, posIndex)
  setSelectedChannel(source.workspaceId, source.channel)
  setSelectedTime(source.workspaceId, source.time)
  setSelectedZ(source.workspaceId, source.z)
  const loaded = await readPositionImage(source.position)
  if (!loaded) {
    return { ok: false, error: "Could not read file from workspace." }
  }
  startWithImage(loaded.src, loaded.baseName, loaded.width, loaded.height, source)
  clearDetectedPoints()
  return { ok: true }
}

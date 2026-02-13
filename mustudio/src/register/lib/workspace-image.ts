import { clearDetectedPoints, loadImage } from "@/register/store"
import { readCurrentPositionImage } from "@/workspace/store"

export async function reloadActiveWorkspaceImage(): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await readCurrentPositionImage()
  if (!loaded) {
    return { ok: false, error: "Could not read selected file. Try a different position/channel/time/z." }
  }
  loadImage(loaded.src, loaded.baseName, loaded.width, loaded.height)
  clearDetectedPoints()
  return { ok: true }
}

import { useState, useCallback, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useStore } from "@tanstack/react-store"
import { Button } from "@/components/ui/button"
import { HexBackground } from "@/components/HexBackground"
import { ThemeToggle } from "@/components/ThemeToggle"
import { useTheme } from "@/components/ThemeProvider"
import { ArrowLeft, Plus } from "lucide-react"
import {
  workspaceStore,
  addWorkspace,
  removeWorkspace,
  setActiveWorkspace,
  setSelectedChannel,
  setSelectedTime,
  setSelectedZ,
  setCurrentIndex,
  getDirHandle,
  restoreDirHandle,
  readPositionImage,
  type Workspace,
} from "@/workspace/store"
import { loadImageFile } from "@/lib/load-tif"
import { startWithImage } from "@/register/store"

const TIFF_RE = /^img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif$/i

function imageToDataURL(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL("image/png")
}

async function scanParentFolder(handle: FileSystemDirectoryHandle): Promise<{
  positions: string[]
  channels: number[]
  times: number[]
  zSlices: number[]
} | null> {
  const positions: string[] = []
  for await (const entry of handle.values()) {
    if (entry.kind === "directory" && /^Pos\d+$/i.test(entry.name)) {
      positions.push(entry.name)
    }
  }
  positions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  if (positions.length === 0) return null

  const channels = new Set<number>()
  const times = new Set<number>()
  const zSlices = new Set<number>()

  const firstPos = await handle.getDirectoryHandle(positions[0])
  for await (const entry of firstPos.values()) {
    if (entry.kind !== "file") continue
    const m = entry.name.match(TIFF_RE)
    if (!m) continue
    channels.add(parseInt(m[1], 10))
    times.add(parseInt(m[3], 10))
    zSlices.add(parseInt(m[4], 10))
  }

  return {
    positions,
    channels: [...channels].sort((a, b) => a - b),
    times: [...times].sort((a, b) => a - b),
    zSlices: [...zSlices].sort((a, b) => a - b),
  }
}

export default function WorkspaceDashboard() {
  const { theme } = useTheme()
  const navigate = useNavigate()
  const workspaces = useStore(workspaceStore, (s) => s.workspaces)
  const activeId = useStore(workspaceStore, (s) => s.activeId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    for (const w of workspaces) {
      if (!getDirHandle(w.id)) {
        restoreDirHandle(w.id).then(() => {})
      }
    }
  }, [workspaces])

  const handleAddWorkspace = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const handle = await window.showDirectoryPicker()
      const result = await scanParentFolder(handle)
      if (!result || result.positions.length === 0) {
        setError("No Pos{N} subdirectories found. Open the output folder of mufile convert.")
        setLoading(false)
        return
      }
      const { positions, channels, times, zSlices } = result
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name: handle.name,
        positions,
        channels: channels.length > 0 ? channels : [0],
        times: times.length > 0 ? times : [0],
        zSlices: zSlices.length > 0 ? zSlices : [0],
        selectedChannel: channels[0] ?? 0,
        selectedTime: times[0] ?? 0,
        selectedZ: zSlices[0] ?? 0,
        currentIndex: 0,
      }
      addWorkspace(workspace, handle)
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") {
        setError("Failed to open folder.")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const handleOpen = useCallback(async (ws: Workspace) => {
    setError(null)
    let handle = getDirHandle(ws.id)
    if (!handle) {
      handle = await restoreDirHandle(ws.id)
    }
    if (!handle) {
      setError("Could not restore folder. Remove and re-add this workspace.")
      return
    }
    try {
      await handle.requestPermission?.({ mode: "read" })
    } catch {
      setError("Permission denied. Try re-adding the workspace.")
      return
    }
    setActiveWorkspace(ws.id)
  }, [])

  const handlePositionClick = useCallback(async (ws: Workspace, posName: string, index: number) => {
    setCurrentIndex(ws.id, index)
    const file = await readPositionImage(posName)
    if (!file) {
      setError("Could not read file. Try re-opening the folder.")
      return
    }
    try {
      const loaded = await loadImageFile(file)
      const dataURL = imageToDataURL(loaded.img)
      startWithImage(dataURL, loaded.baseName, loaded.width, loaded.height)
      navigate("/register")
    } catch {
      setError("Failed to decode image.")
    }
  }, [navigate])

  const activeWorkspace = activeId ? workspaces.find((w) => w.id === activeId) : null

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-2xl space-y-4 backdrop-blur-sm bg-background/80 rounded-lg border p-6">
        {activeWorkspace ? (
          <>
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon-sm" onClick={() => setActiveWorkspace(null)}>
                <ArrowLeft className="size-4" />
              </Button>
              <h2 className="text-lg font-medium">{activeWorkspace.name}</h2>
            </div>

            <div className="flex flex-wrap gap-4">
              <div>
                <label className="text-sm text-muted-foreground mr-2">Channel</label>
                <select
                  className="border rounded px-2 py-1 bg-background"
                  value={activeWorkspace.selectedChannel}
                  onChange={(e) => setSelectedChannel(activeWorkspace.id, Number(e.target.value))}
                >
                  {activeWorkspace.channels.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mr-2">Time</label>
                <select
                  className="border rounded px-2 py-1 bg-background"
                  value={activeWorkspace.selectedTime}
                  onChange={(e) => setSelectedTime(activeWorkspace.id, Number(e.target.value))}
                >
                  {activeWorkspace.times.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mr-2">Z</label>
                <select
                  className="border rounded px-2 py-1 bg-background"
                  value={activeWorkspace.selectedZ}
                  onChange={(e) => setSelectedZ(activeWorkspace.id, Number(e.target.value))}
                >
                  {activeWorkspace.zSlices.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {activeWorkspace.positions.map((posName, i) => (
                <button
                  key={posName}
                  onClick={() => handlePositionClick(activeWorkspace, posName, i)}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                    i === activeWorkspace.currentIndex
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  <span className="text-muted-foreground mr-2">{i + 1}.</span>
                  {posName}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Workspaces</h2>
              <Button onClick={handleAddWorkspace} disabled={loading}>
                <Plus className="size-4" />
                {loading ? "Scanning..." : "Add workspace"}
              </Button>
            </div>

            {workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Add a workspace to get started. Open the output folder of mufile convert.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className="border rounded-lg p-4 flex flex-col gap-3"
                  >
                    <p className="font-medium">{ws.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {ws.positions.length} position{ws.positions.length !== 1 ? "s" : ""}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleOpen(ws)}>
                        Open
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeWorkspace(ws.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </div>
  )
}

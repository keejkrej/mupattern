import { useState, useCallback } from "react"
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
  setCurrentIndex,
  addPositionTag,
  removePositionTag,
  togglePositionTagFilter,
  clearPositionTagFilters,
  getWorkspaceVisiblePositionIndices,
  type Workspace,
} from "@/workspace/store"
import { parseSliceStringOverValues } from "@/lib/slices"

export default function WorkspaceDashboard() {
  const { theme } = useTheme()
  const navigate = useNavigate()
  const workspaces = useStore(workspaceStore, (s) => s.workspaces)
  const activeId = useStore(workspaceStore, (s) => s.activeId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tagLabel, setTagLabel] = useState("")
  const [tagSlice, setTagSlice] = useState("0")

  const handleAddWorkspace = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const result = await window.mustudio.workspace.pickDirectory()
      if (!result || result.positions.length === 0) {
        setError("No Pos{N} subdirectories found. Open the output folder of mufile convert.")
        setLoading(false)
        return
      }
      const { path, name, positions, channels, times, zSlices } = result
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name,
        rootPath: path,
        positions,
        posTags: [],
        positionFilterLabels: [],
        channels: channels.length > 0 ? channels : [0],
        times: times.length > 0 ? times : [0],
        zSlices: zSlices.length > 0 ? zSlices : [0],
        selectedChannel: channels[0] ?? 0,
        selectedTime: times[0] ?? 0,
        selectedZ: zSlices[0] ?? 0,
        currentIndex: 0,
      }
      addWorkspace(workspace)
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
    if (!ws.rootPath) {
      setError("Workspace path is unavailable. Remove and re-add this workspace.")
      return
    }
    setActiveWorkspace(ws.id)
  }, [])

  const handlePositionSelect = useCallback((ws: Workspace, index: number) => {
    setError(null)
    setCurrentIndex(ws.id, index)
  }, [])

  const handleAddTag = useCallback((ws: Workspace) => {
    const label = tagLabel.trim()
    if (!label) {
      setError("Tag label is required.")
      return
    }

    let indices: number[] = []
    try {
      indices = parseSliceStringOverValues(tagSlice, ws.positions)
    } catch (e) {
      setError((e as Error).message)
      return
    }

    // Compress parsed indices into contiguous ranges to match store tag model.
    let runStart = indices[0]
    let runEnd = indices[0]
    for (let i = 1; i < indices.length; i += 1) {
      const idx = indices[i]
      if (idx === runEnd + 1) {
        runEnd = idx
        continue
      }
      addPositionTag(ws.id, label, runStart, runEnd)
      runStart = idx
      runEnd = idx
    }
    addPositionTag(ws.id, label, runStart, runEnd)

    setError(null)
    setTagLabel("")
  }, [tagLabel, tagSlice])

  const handleOpenRegister = useCallback(() => {
    setError(null)
    navigate("/register")
  }, [navigate])

  const activeWorkspace = activeId ? workspaces.find((w) => w.id === activeId) : null
  const visibleIndices = activeWorkspace ? getWorkspaceVisiblePositionIndices(activeWorkspace) : []
  const filterLabels = activeWorkspace
    ? [...new Set(activeWorkspace.posTags.map((tag) => tag.label))].sort((a, b) => a.localeCompare(b))
    : []

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-2xl space-y-4 backdrop-blur-sm bg-background/80 rounded-lg border p-6">
        <div className="text-center">
          <h1 className="text-4xl tracking-tight" style={{ fontFamily: "\"Bitcount\", monospace" }}>
            MuStudio
          </h1>
          <div className="mt-3 border-t border-border/70" />
        </div>

        {activeWorkspace ? (
            <>
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon-sm" onClick={() => setActiveWorkspace(null)}>
                <ArrowLeft className="size-4" />
              </Button>
              <h2 className="text-lg font-medium">{activeWorkspace.name}</h2>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              <div className="flex flex-wrap items-end gap-2 rounded-md border p-2 mb-2 bg-background/60">
                <div className="min-w-40 flex-1">
                  <label className="text-xs text-muted-foreground">Tag</label>
                  <input
                    type="text"
                    value={tagLabel}
                    onChange={(e) => setTagLabel(e.target.value)}
                    placeholder="sample-a"
                    className="w-full h-8 px-2 rounded border bg-background text-sm"
                  />
                </div>
                <div className="min-w-48 flex-1">
                  <label className="text-xs text-muted-foreground">Slice</label>
                  <input
                    type="text"
                    value={tagSlice}
                    onChange={(e) => setTagSlice(e.target.value)}
                    placeholder="all | 140 | 140:160:5"
                    className="w-full h-8 px-2 rounded border bg-background text-sm"
                  />
                </div>
                <Button size="sm" onClick={() => handleAddTag(activeWorkspace)}>
                  Add tag slice
                </Button>
                <div className="min-w-48 flex-1">
                  <label className="text-xs text-muted-foreground">Filter</label>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className={`px-2 py-1 rounded border text-xs ${
                        activeWorkspace.positionFilterLabels.length === 0 ? "bg-primary/10 border-primary" : "bg-background"
                      }`}
                      onClick={() => clearPositionTagFilters(activeWorkspace.id)}
                    >
                      All
                    </button>
                    {filterLabels.map((label) => (
                      <button
                        key={label}
                        type="button"
                        className={`px-2 py-1 rounded border text-xs ${
                          activeWorkspace.positionFilterLabels.includes(label)
                            ? "bg-primary/10 border-primary"
                            : "bg-background"
                        }`}
                        onClick={() => togglePositionTagFilter(activeWorkspace.id, label)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {visibleIndices.map((i) => {
                  const pos = activeWorkspace.positions[i]
                  const tags = activeWorkspace.posTags.filter((tag) => i >= tag.startIndex && i <= tag.endIndex)
                  return (
                    <div
                      key={pos}
                      onClick={() => handlePositionSelect(activeWorkspace, i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          handlePositionSelect(activeWorkspace, i)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`text-left rounded border text-sm transition-colors ${
                        i === activeWorkspace.currentIndex
                          ? "border-primary bg-primary/10"
                          : "hover:bg-accent"
                      }`}
                    >
                      <div className="px-3 py-2">
                        <span className="font-medium">{pos}</span>
                      </div>
                      <div className="border-t px-3 py-2 flex flex-wrap gap-1 min-h-9">
                        {tags.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No tags</span>
                        ) : (
                          tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-background"
                            >
                              {tag.label}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removePositionTag(activeWorkspace.id, tag.id)
                                }}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={`Remove ${tag.label} tag`}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => navigate("/see")}
                className="whitespace-normal leading-tight"
              >
                <span className="text-center">
                  load in
                  <br />
                  See
                </span>
              </Button>
              <Button
                onClick={handleOpenRegister}
                disabled={visibleIndices.length === 0}
                className="whitespace-normal leading-tight"
              >
                <span className="text-center">
                  load in
                  <br />
                  Register
                </span>
              </Button>
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

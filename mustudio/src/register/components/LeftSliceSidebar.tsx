import { useCallback, useMemo, useState } from "react"
import { useStore } from "@tanstack/react-store"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  getWorkspaceVisiblePositionIndices,
  workspaceStore,
  nextPosition,
  prevPosition,
  saveWorkspaceBboxCsv,
  setCurrentIndex,
  setSelectedChannel,
  setSelectedTime,
  setSelectedZ,
} from "@/workspace/store"
import { reloadActiveWorkspaceImage } from "@/register/lib/workspace-image"
import { buildBBoxCsv } from "@/register/lib/bbox-csv"
import type { PatternPixels, Transform } from "@/register/types"

const MIN_SAVE_FEEDBACK_MS = 900

interface LeftSliceSidebarProps {
  onWorkspaceImageError: (message: string | null) => void
  canvasSize: { width: number; height: number }
  patternPx: PatternPixels
  transform: Transform
  hasImage: boolean
  hasDetectedPoints: boolean
  onDetect: () => void
  onFitGrid: (basisAngle: number) => void
  onReset: () => void
}

export function LeftSliceSidebar({
  onWorkspaceImageError,
  canvasSize,
  patternPx,
  transform,
  hasImage,
  hasDetectedPoints,
  onDetect,
  onFitGrid,
  onReset,
}: LeftSliceSidebarProps) {
  const [saving, setSaving] = useState(false)
  const activeWorkspace = useStore(workspaceStore, (s) => {
    const { activeId, workspaces } = s
    if (!activeId) return null
    return workspaces.find((w) => w.id === activeId) ?? null
  })

  const currentPosition = useMemo(() => {
    if (!activeWorkspace) return null
    return activeWorkspace.positions[activeWorkspace.currentIndex] ?? null
  }, [activeWorkspace])
  const visibleIndices = useMemo(() => {
    if (!activeWorkspace) return []
    return getWorkspaceVisiblePositionIndices(activeWorkspace)
  }, [activeWorkspace])
  const currentVisibleOffset = useMemo(() => {
    if (!activeWorkspace) return -1
    return visibleIndices.indexOf(activeWorkspace.currentIndex)
  }, [activeWorkspace, visibleIndices])

  const reload = useCallback(async () => {
    const result = await reloadActiveWorkspaceImage()
    onWorkspaceImageError(result.ok ? null : result.error)
  }, [onWorkspaceImageError])

  const handlePositionChange = useCallback(async (value: string) => {
    if (!activeWorkspace) return
    const numericValue = Number.parseInt(value, 10)
    const nextIndex = visibleIndices.find((index) => activeWorkspace.positions[index] === numericValue)
    if (nextIndex == null || nextIndex === activeWorkspace.currentIndex) return
    setCurrentIndex(activeWorkspace.id, nextIndex)
    await reload()
  }, [activeWorkspace, reload, visibleIndices])

  const handleChannelChange = useCallback(async (value: number) => {
    if (!activeWorkspace || value === activeWorkspace.selectedChannel) return
    setSelectedChannel(activeWorkspace.id, value)
    await reload()
  }, [activeWorkspace, reload])

  const handleTimeChange = useCallback(async (value: number) => {
    if (!activeWorkspace || value === activeWorkspace.selectedTime) return
    setSelectedTime(activeWorkspace.id, value)
    await reload()
  }, [activeWorkspace, reload])

  const handleZChange = useCallback(async (value: number) => {
    if (!activeWorkspace || value === activeWorkspace.selectedZ) return
    setSelectedZ(activeWorkspace.id, value)
    await reload()
  }, [activeWorkspace, reload])

  const handleChannelStep = useCallback(async (delta: -1 | 1) => {
    if (!activeWorkspace) return
    const i = activeWorkspace.channels.indexOf(activeWorkspace.selectedChannel)
    if (i < 0) return
    const next = i + delta
    if (next < 0 || next >= activeWorkspace.channels.length) return
    setSelectedChannel(activeWorkspace.id, activeWorkspace.channels[next])
    await reload()
  }, [activeWorkspace, reload])

  const handleTimeStep = useCallback(async (delta: -1 | 1) => {
    if (!activeWorkspace) return
    const i = activeWorkspace.times.indexOf(activeWorkspace.selectedTime)
    if (i < 0) return
    const next = i + delta
    if (next < 0 || next >= activeWorkspace.times.length) return
    setSelectedTime(activeWorkspace.id, activeWorkspace.times[next])
    await reload()
  }, [activeWorkspace, reload])

  const handleZStep = useCallback(async (delta: -1 | 1) => {
    if (!activeWorkspace) return
    const i = activeWorkspace.zSlices.indexOf(activeWorkspace.selectedZ)
    if (i < 0) return
    const next = i + delta
    if (next < 0 || next >= activeWorkspace.zSlices.length) return
    setSelectedZ(activeWorkspace.id, activeWorkspace.zSlices[next])
    await reload()
  }, [activeWorkspace, reload])

  const handlePrevPosition = useCallback(async () => {
    if (!activeWorkspace || activeWorkspace.currentIndex <= 0) return
    prevPosition(activeWorkspace.id)
    await reload()
  }, [activeWorkspace, reload])

  const handleNextPosition = useCallback(async () => {
    if (!activeWorkspace) return
    const visible = getWorkspaceVisiblePositionIndices(activeWorkspace)
    const current = visible.indexOf(activeWorkspace.currentIndex)
    if (current < 0 || current >= visible.length - 1) return
    nextPosition(activeWorkspace.id)
    await reload()
  }, [activeWorkspace, reload])

  const handleSave = useCallback(async () => {
    if (!activeWorkspace || currentPosition == null || saving) return
    const saveStartedAt = Date.now()
    setSaving(true)
    try {
      const csv = buildBBoxCsv(canvasSize, patternPx, transform)
      const ok = await saveWorkspaceBboxCsv(activeWorkspace.id, currentPosition, csv)
      if (!ok) {
        onWorkspaceImageError("Failed to save bbox CSV to workspace.")
        return
      }
      onWorkspaceImageError(null)
    } catch {
      onWorkspaceImageError("Failed to save bbox CSV to workspace.")
    } finally {
      const elapsed = Date.now() - saveStartedAt
      const remaining = MIN_SAVE_FEEDBACK_MS - elapsed
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining))
      }
      setSaving(false)
    }
  }, [activeWorkspace, canvasSize, currentPosition, onWorkspaceImageError, patternPx, saving, transform])

  const hasWorkspace = !!activeWorkspace && visibleIndices.length > 0

  return (
    <aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-border p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">Actions</h2>
        <div className="space-y-2">
          <Button
            variant="secondary"
            size="sm"
            className="w-full h-7 text-base"
            disabled={!hasImage}
            onClick={onDetect}
          >
            Detect cells
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="w-full h-7 text-base"
            disabled={!hasDetectedPoints}
            onClick={() => onFitGrid(Math.PI / 2)}
          >
            Auto square (a=b)
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="w-full h-7 text-base"
            disabled={!hasDetectedPoints}
            onClick={() => onFitGrid(Math.PI / 3)}
          >
            Auto hex (a=b)
          </Button>
          <div className="flex gap-1.5">
            <Button variant="secondary" size="sm" className="flex-1 h-7 text-base" onClick={onReset}>
              Reset
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 h-7 text-base"
              disabled={!hasWorkspace || currentPosition == null || saving}
              onClick={() => { void handleSave() }}
              title="Save bbox CSV to workspace"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
      {hasWorkspace && (
        <>
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Image Slice</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Choose position and stack indices.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Position</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => { void handlePrevPosition() }}
              disabled={currentVisibleOffset <= 0}
              title="Previous position"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={currentPosition == null ? "" : String(currentPosition)}
              onChange={(e) => { void handlePositionChange(e.target.value) }}
            >
              {visibleIndices.map((index) => {
                const pos = activeWorkspace.positions[index]
                return (
                <option key={pos} value={String(pos)}>{pos}</option>
                )
              })}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => { void handleNextPosition() }}
              disabled={currentVisibleOffset < 0 || currentVisibleOffset >= visibleIndices.length - 1}
              title="Next position"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Channel</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => { void handleChannelStep(-1) }}
              disabled={activeWorkspace.channels.indexOf(activeWorkspace.selectedChannel) <= 0}
              title="Previous channel"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={activeWorkspace.selectedChannel}
              onChange={(e) => { void handleChannelChange(Number(e.target.value)) }}
            >
              {activeWorkspace.channels.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => { void handleChannelStep(1) }}
              disabled={activeWorkspace.channels.indexOf(activeWorkspace.selectedChannel) >= activeWorkspace.channels.length - 1}
              title="Next channel"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Time</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => { void handleTimeStep(-1) }}
              disabled={activeWorkspace.times.indexOf(activeWorkspace.selectedTime) <= 0}
              title="Previous time"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={activeWorkspace.selectedTime}
              onChange={(e) => { void handleTimeChange(Number(e.target.value)) }}
            >
              {activeWorkspace.times.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => { void handleTimeStep(1) }}
              disabled={activeWorkspace.times.indexOf(activeWorkspace.selectedTime) >= activeWorkspace.times.length - 1}
              title="Next time"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Z</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => { void handleZStep(-1) }}
              disabled={activeWorkspace.zSlices.indexOf(activeWorkspace.selectedZ) <= 0}
              title="Previous z"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={activeWorkspace.selectedZ}
              onChange={(e) => { void handleZChange(Number(e.target.value)) }}
            >
              {activeWorkspace.zSlices.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => { void handleZStep(1) }}
              disabled={activeWorkspace.zSlices.indexOf(activeWorkspace.selectedZ) >= activeWorkspace.zSlices.length - 1}
              title="Next z"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
        </>
      )}
    </aside>
  )
}

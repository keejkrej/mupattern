import { useCallback } from "react"
import { useStore } from "@tanstack/react-store"
import { useNavigate } from "react-router-dom"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Home } from "lucide-react"
import {
  workspaceStore,
  nextPosition,
  prevPosition,
  readCurrentPositionImage,
} from "@/workspace/store"
import { loadImage } from "@/register/store"
import { loadImageFile } from "@/lib/load-tif"

/** Convert an HTMLImageElement to a data URL. */
function imageToDataURL(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL("image/png")
}

export function Header() {
  const navigate = useNavigate()
  const activeWorkspace = useStore(workspaceStore, (s) => {
    const { activeId, workspaces } = s
    if (!activeId) return null
    return workspaces.find((w) => w.id === activeId) ?? null
  })
  const hasWorkspace = activeWorkspace !== null && activeWorkspace.positions.length > 0
  const currentIndex = activeWorkspace?.currentIndex ?? 0
  const positionCount = activeWorkspace?.positions.length ?? 0

  const handlePrev = useCallback(async () => {
    if (!activeWorkspace || currentIndex <= 0) return
    prevPosition(activeWorkspace.id)
    const file = await readCurrentPositionImage()
    if (!file) return
    try {
      const loaded = await loadImageFile(file)
      const dataURL = imageToDataURL(loaded.img)
      loadImage(dataURL, loaded.baseName, loaded.width, loaded.height)
    } catch {
      // silently fail
    }
  }, [activeWorkspace, currentIndex])

  const handleNext = useCallback(async () => {
    if (!activeWorkspace || currentIndex >= positionCount - 1) return
    nextPosition(activeWorkspace.id)
    const file = await readCurrentPositionImage()
    if (!file) return
    try {
      const loaded = await loadImageFile(file)
      const dataURL = imageToDataURL(loaded.img)
      loadImage(dataURL, loaded.baseName, loaded.width, loaded.height)
    } catch {
      // silently fail
    }
  }, [activeWorkspace, currentIndex, positionCount])

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-6">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate("/workspace")}
          title="Back to workspace"
        >
          <Home className="size-4" />
        </Button>
        <div>
          <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Bitcount", monospace' }}>MuRegister</h1>
          <p className="text-base text-muted-foreground">
            Microscopy pattern-to-image registration
          </p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        {hasWorkspace && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handlePrev}
              disabled={currentIndex <= 0}
              title="Previous position"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm text-muted-foreground min-w-[4rem] text-center">
              {currentIndex + 1} / {positionCount}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleNext}
              disabled={currentIndex >= positionCount - 1}
              title="Next position"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
        <p className="text-base text-muted-foreground">
          Drag: pan | Middle-drag: resize | Right-drag: rotate
        </p>
        <ThemeToggle />
      </div>
    </header>
  )
}

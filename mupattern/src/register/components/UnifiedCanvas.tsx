import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react"
import { useTheme } from "@/components/ThemeProvider"
import type { PatternPixels, Transform } from "@/register/types"

interface UnifiedCanvasProps {
  /** Pre-normalized phase contrast (canvas); drawn as-is, no per-frame normalization. */
  displayImage: HTMLCanvasElement | null
  canvasSize: { width: number; height: number }
  imageBaseName: string
  patternPx: PatternPixels
  transform: Transform
  onTransformUpdate: (updates: Partial<Transform>) => void
  onZoom: (factor: number) => void
  onRotate: (deltaRad: number) => void
  onExportYAML?: () => void
  patternOpacity: number
  detectedPoints?: Array<{ x: number; y: number }> | null
}

export interface UnifiedCanvasRef {
  exportPNG: () => void
  exportCSV: () => void
  exportAll: () => void
}

export const UnifiedCanvas = forwardRef<UnifiedCanvasRef, UnifiedCanvasProps>(
  function UnifiedCanvas({ displayImage, canvasSize, imageBaseName, patternPx, transform, onTransformUpdate, onZoom, onRotate, onExportYAML, patternOpacity, detectedPoints }, ref) {
    const { theme } = useTheme()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    type DragMode = "none" | "pan" | "rotate" | "resize"
    const dragMode = useRef<DragMode>("none")
    const lastPos = useRef({ x: 0, y: 0 })

    const drawLattice = useCallback((
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      pattern: PatternPixels,
      tx: Transform,
      mode: "preview" | "export"
    ) => {
      const { lattice, width: rectW, height: rectH } = pattern
      const vec1 = {
        x: lattice.a * Math.cos(lattice.alpha),
        y: lattice.a * Math.sin(lattice.alpha),
      }
      const vec2 = {
        x: lattice.b * Math.cos(lattice.beta),
        y: lattice.b * Math.sin(lattice.beta),
      }

      const halfW = rectW / 2
      const halfH = rectH / 2

      // Center of canvas is the pattern origin, offset by translation
      const cx = width / 2
      const cy = height / 2

      // Calculate range needed to cover the entire canvas
      const minLen = Math.min(
        Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y),
        Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y)
      )
      const maxDim = Math.max(width, height) * 2
      const maxRange = minLen > 0 ? Math.ceil(maxDim / minLen) + 2 : 20

      ctx.save()
      ctx.translate(cx + tx.tx, cy + tx.ty)

      if (mode === "preview") {
        ctx.fillStyle = `rgba(59, 130, 246, ${Math.max(0, Math.min(1, patternOpacity))})`
      } else {
        ctx.fillStyle = "#ffffff"
      }

      for (let i = -maxRange; i <= maxRange; i++) {
        for (let j = -maxRange; j <= maxRange; j++) {
          const x = i * vec1.x + j * vec2.x
          const y = i * vec1.y + j * vec2.y

          // Check if point is in viewport (approximate, accounting for rotation)
          const absX = Math.abs(x + tx.tx)
          const absY = Math.abs(y + tx.ty)
          if (absX > maxDim || absY > maxDim) continue

          ctx.fillRect(x - halfW, y - halfH, rectW, rectH)
        }
      }

      // Highlight overlapping regions in preview mode
      if (mode === "preview") {
        const neighborOffsets = [
          { dx: vec1.x, dy: vec1.y },
          { dx: vec2.x, dy: vec2.y },
          { dx: vec1.x + vec2.x, dy: vec1.y + vec2.y },
          { dx: vec1.x - vec2.x, dy: vec1.y - vec2.y },
        ]
        const overlapOffsets = neighborOffsets
          .map(({ dx, dy }) => ({
            dx, dy,
            ow: rectW - Math.abs(dx),
            oh: rectH - Math.abs(dy),
          }))
          .filter(({ ow, oh }) => ow > 0 && oh > 0)

        if (overlapOffsets.length > 0) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.6)"
          for (let i = -maxRange; i <= maxRange; i++) {
            for (let j = -maxRange; j <= maxRange; j++) {
              const x = i * vec1.x + j * vec2.x
              const y = i * vec1.y + j * vec2.y
              const absX = Math.abs(x + tx.tx)
              const absY = Math.abs(y + tx.ty)
              if (absX > maxDim || absY > maxDim) continue

              for (const { dx, dy, ow, oh } of overlapOffsets) {
                ctx.fillRect(x + dx / 2 - ow / 2, y + dy / 2 - oh / 2, ow, oh)
              }
            }
          }
        }
      }

      // Draw visual aids in preview mode
      if (mode === "preview") {
        // Origin marker
        ctx.beginPath()
        ctx.arc(0, 0, 4, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
        ctx.fill()

        // Basis vector 1
        ctx.strokeStyle = "rgba(255, 100, 100, 0.8)"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(vec1.x, vec1.y)
        ctx.stroke()
        const a1 = Math.atan2(vec1.y, vec1.x)
        ctx.beginPath()
        ctx.moveTo(vec1.x, vec1.y)
        ctx.lineTo(vec1.x - 8 * Math.cos(a1 - 0.3), vec1.y - 8 * Math.sin(a1 - 0.3))
        ctx.moveTo(vec1.x, vec1.y)
        ctx.lineTo(vec1.x - 8 * Math.cos(a1 + 0.3), vec1.y - 8 * Math.sin(a1 + 0.3))
        ctx.stroke()

        // Basis vector 2
        ctx.strokeStyle = "rgba(100, 255, 100, 0.8)"
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(vec2.x, vec2.y)
        ctx.stroke()
        const a2 = Math.atan2(vec2.y, vec2.x)
        ctx.beginPath()
        ctx.moveTo(vec2.x, vec2.y)
        ctx.lineTo(vec2.x - 8 * Math.cos(a2 - 0.3), vec2.y - 8 * Math.sin(a2 - 0.3))
        ctx.moveTo(vec2.x, vec2.y)
        ctx.lineTo(vec2.x - 8 * Math.cos(a2 + 0.3), vec2.y - 8 * Math.sin(a2 + 0.3))
        ctx.stroke()
      }

      ctx.restore()

      // Crosshair (in canvas space, not transformed)
      if (mode === "preview") {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, 0)
        ctx.lineTo(cx, height)
        ctx.moveTo(0, cy)
        ctx.lineTo(width, cy)
        ctx.stroke()
      }
    }, [patternOpacity])

    const draw = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      // Clear
      ctx.fillStyle = theme === "dark" ? "#262626" : "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      if (displayImage) {
        ctx.drawImage(displayImage, 0, 0, canvas.width, canvas.height)
      }

      // Draw pattern overlay with transform
      drawLattice(ctx, canvas.width, canvas.height, patternPx, transform, "preview")

      // Draw detected grid points as crosses
      if (detectedPoints && detectedPoints.length > 0) {
        ctx.save()
        ctx.strokeStyle = "rgba(0, 255, 100, 0.85)"
        ctx.lineWidth = 2
        const arm = 5
        for (const { x, y } of detectedPoints) {
          ctx.beginPath()
          ctx.moveTo(x - arm, y)
          ctx.lineTo(x + arm, y)
          ctx.moveTo(x, y - arm)
          ctx.lineTo(x, y + arm)
          ctx.stroke()
        }
        ctx.restore()
      }
    }, [displayImage, patternPx, transform, drawLattice, theme, detectedPoints])

    useEffect(() => {
      draw()
    }, [draw])

    // Resize canvas when dimensions change
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = canvasSize.width
      canvas.height = canvasSize.height
      draw()
    }, [canvasSize, draw])

    // Export: white-on-black pattern, same dimensions as canvas
    const exportPNG = useCallback(() => {
      const w = canvasSize.width
      const h = canvasSize.height

      const exportCanvas = document.createElement("canvas")
      exportCanvas.width = w
      exportCanvas.height = h
      const ctx = exportCanvas.getContext("2d")
      if (!ctx) return

      ctx.fillStyle = "#000000"
      ctx.fillRect(0, 0, w, h)
      drawLattice(ctx, w, h, patternPx, transform, "export")

      // Flood-fill erase any white regions touching the boundary
      const imageData = ctx.getImageData(0, 0, w, h)
      const data = imageData.data
      const visited = new Uint8Array(w * h)

      const queue: number[] = []
      const enqueue = (idx: number) => {
        if (!visited[idx] && data[idx * 4] > 0) {
          visited[idx] = 1
          queue.push(idx)
        }
      }

      // Seed from all 4 borders
      for (let x = 0; x < w; x++) {
        enqueue(x)                 // top row
        enqueue((h - 1) * w + x)  // bottom row
      }
      for (let y = 0; y < h; y++) {
        enqueue(y * w)             // left column
        enqueue(y * w + w - 1)     // right column
      }

      // BFS flood fill: erase connected white pixels
      while (queue.length > 0) {
        const idx = queue.pop()!
        const px = idx * 4
        data[px] = 0
        data[px + 1] = 0
        data[px + 2] = 0

        const x = idx % w
        const y = (idx - x) / w
        if (x > 0) enqueue(idx - 1)
        if (x < w - 1) enqueue(idx + 1)
        if (y > 0) enqueue(idx - w)
        if (y < h - 1) enqueue(idx + w)
      }

      ctx.putImageData(imageData, 0, 0)

      const link = document.createElement("a")
      link.download = `${imageBaseName}_mask.png`
      link.href = exportCanvas.toDataURL("image/png")
      link.click()
    }, [canvasSize, imageBaseName, patternPx, transform, drawLattice])

    const exportCSV = useCallback(() => {
      const w = canvasSize.width
      const h = canvasSize.height
      const { lattice, width: rectW, height: rectH } = patternPx

      const vec1 = {
        x: lattice.a * Math.cos(lattice.alpha),
        y: lattice.a * Math.sin(lattice.alpha),
      }
      const vec2 = {
        x: lattice.b * Math.cos(lattice.beta),
        y: lattice.b * Math.sin(lattice.beta),
      }

      const cx = w / 2 + transform.tx
      const cy = h / 2 + transform.ty
      const halfW = rectW / 2
      const halfH = rectH / 2

      const minLen = Math.min(
        Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y),
        Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y)
      )
      const maxDim = Math.max(w, h) * 2
      const maxRange = minLen > 0 ? Math.ceil(maxDim / minLen) + 2 : 20

      const rows: string[] = ["crop,x,y,w,h"]
      let crop = 0

      for (let i = -maxRange; i <= maxRange; i++) {
        for (let j = -maxRange; j <= maxRange; j++) {
          const px = cx + i * vec1.x + j * vec2.x
          const py = cy + i * vec1.y + j * vec2.y
          const bx = px - halfW
          const by = py - halfH

          // Only include rectangles fully within image bounds
          if (bx >= 0 && by >= 0 && bx + rectW <= w && by + rectH <= h) {
            rows.push(`${crop},${Math.round(bx)},${Math.round(by)},${Math.round(rectW)},${Math.round(rectH)}`)
            crop++
          }
        }
      }

      const blob = new Blob([rows.join("\n")], { type: "text/csv" })
      const link = document.createElement("a")
      link.download = `${imageBaseName}_bbox.csv`
      link.href = URL.createObjectURL(blob)
      link.click()
      URL.revokeObjectURL(link.href)
    }, [canvasSize, imageBaseName, patternPx, transform])

    const exportAll = useCallback(() => {
      exportPNG()
      exportCSV()
      onExportYAML?.()
    }, [exportPNG, exportCSV, onExportYAML])

    useImperativeHandle(ref, () => ({ exportPNG, exportCSV, exportAll }), [exportPNG, exportCSV, exportAll])

    // --- Mouse interactions: move the pattern overlay ---

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      if (e.button === 2) {
        dragMode.current = "rotate"
      } else if (e.button === 1) {
        dragMode.current = "resize"
      } else if (e.button === 0) {
        dragMode.current = "pan"
      }
      lastPos.current = { x: e.clientX, y: e.clientY }
    }, [])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (dragMode.current === "none") return

      const dx = e.clientX - lastPos.current.x
      const dy = e.clientY - lastPos.current.y
      lastPos.current = { x: e.clientX, y: e.clientY }

      switch (dragMode.current) {
        case "rotate":
          onRotate(dx * 0.003)
          break
        case "resize":
          onZoom(1 + dx * 0.002)
          break
        case "pan":
          onTransformUpdate({
            tx: transform.tx + dx,
            ty: transform.ty + dy,
          })
          break
      }
    }, [transform, onTransformUpdate, onRotate, onZoom])

    const handleMouseUp = useCallback(() => {
      dragMode.current = "none"
    }, [])

    return (
      <div className="flex-1 overflow-auto rounded-lg border border-border bg-muted/30 p-1 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={2048}
          height={2048}
          className="max-w-full max-h-full object-contain cursor-move"
          onMouseDown={(e) => { e.preventDefault(); handleMouseDown(e) }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    )
  }
)

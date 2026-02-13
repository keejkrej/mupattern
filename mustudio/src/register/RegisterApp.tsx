import { useCallback, useMemo, useState, useEffect } from "react"
import { useStore } from "@tanstack/react-store"
import { Header } from "@/register/components/Header"
import { LeftSliceSidebar } from "@/register/components/LeftSliceSidebar"
import { Sidebar } from "@/register/components/Sidebar"
import { UnifiedCanvas } from "@/register/components/UnifiedCanvas"
import { patternToPixels } from "@/register/lib/units"
import {
  appStore,
  setPattern,
  updateLattice,
  updateWidth,
  updateHeight,
  scalePattern,
  rotatePattern,
  updateTransform,
  setCalibration,
  setPatternOpacity,
  resetPatternAndTransform,
  setDetectedPoints,
  clearDetectedPoints,
} from "@/register/store"
import { detectGridPoints, fitGrid } from "@/register/lib/autodetect"
import { pixelsToUm } from "@/register/lib/units"
import { normalizeImageDataForDisplayAsync } from "@/register/lib/normalize"

/** Convert a data URL to an HTMLImageElement (async). */
function useImageFromDataURL(dataURL: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!dataURL) {
      setImg(null)
      return
    }
    const image = new Image()
    image.onload = () => setImg(image)
    image.src = dataURL
    return () => {
      if (dataURL.startsWith("blob:")) {
        URL.revokeObjectURL(dataURL)
      }
    }
  }, [dataURL])

  return img
}

/** Normalize phase contrast once; returns canvas with mutated (in-place) normalized pixels. Used for display and detection. */
function useNormalizedPhaseContrast(phaseContrast: HTMLImageElement | null): HTMLCanvasElement | null {
  const [normalized, setNormalized] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!phaseContrast) {
      setNormalized(null)
      return
    }

    const run = async () => {
      const canvas = document.createElement("canvas")
      canvas.width = phaseContrast.width
      canvas.height = phaseContrast.height
      const ctx = canvas.getContext("2d")!
      ctx.drawImage(phaseContrast, 0, 0)
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const normalizedData = await normalizeImageDataForDisplayAsync(imgData)
      if (cancelled) return
      ctx.putImageData(normalizedData, 0, 0)
      setNormalized(canvas)
    }

    run().catch(() => {
      if (!cancelled) {
        setNormalized(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [phaseContrast])

  return normalized
}

export default function RegisterApp() {
  const imageDataURL = useStore(appStore, (s) => s.imageDataURL)
  const imageBaseName = useStore(appStore, (s) => s.imageBaseName)
  const canvasSize = useStore(appStore, (s) => s.canvasSize)
  const pattern = useStore(appStore, (s) => s.pattern)
  const transform = useStore(appStore, (s) => s.transform)
  const calibration = useStore(appStore, (s) => s.calibration)
  const patternOpacity = useStore(appStore, (s) => s.patternOpacity)
  const detectedPoints = useStore(appStore, (s) => s.detectedPoints)
  const [workspaceImageError, setWorkspaceImageError] = useState<string | null>(null)

  const phaseContrast = useImageFromDataURL(imageDataURL)
  const normalizedPhaseContrast = useNormalizedPhaseContrast(phaseContrast)

  const patternPx = useMemo(
    () => patternToPixels(pattern, calibration),
    [pattern, calibration]
  )

  const handleDetect = useCallback(() => {
    if (!normalizedPhaseContrast) return
    const points = detectGridPoints(normalizedPhaseContrast, 5)
    if (points.length < 3) {
      alert(`Detection found only ${points.length} point(s) — need at least 3. Try a different image.`)
    }
    setDetectedPoints(points)
  }, [normalizedPhaseContrast])

  const handleFitGrid = useCallback((basisAngle: number) => {
    if (!detectedPoints || detectedPoints.length < 3) return
    const fit = fitGrid(detectedPoints, canvasSize.width, canvasSize.height, basisAngle)
    if (fit) {
      updateLattice({
        a: pixelsToUm(fit.a, calibration),
        alpha: fit.alpha,
        b: pixelsToUm(fit.b, calibration),
        beta: fit.beta,
      })
      updateTransform({ tx: fit.tx, ty: fit.ty })
    } else {
      alert("Grid fitting failed — no matching lattice directions found. Try the other mode or adjust manually.")
    }
  }, [detectedPoints, canvasSize, calibration])

  const handleReset = useCallback(() => {
    resetPatternAndTransform()
    clearDetectedPoints()
  }, [])

  return (
    <div className="flex h-screen flex-col">
      <Header />
      {workspaceImageError && (
        <div className="px-4 py-2 text-sm text-destructive border-b border-border bg-destructive/5">
          {workspaceImageError}
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <LeftSliceSidebar
          onWorkspaceImageError={setWorkspaceImageError}
          canvasSize={canvasSize}
          patternPx={patternPx}
          transform={transform}
        />
        <UnifiedCanvas
          displayImage={normalizedPhaseContrast}
          canvasSize={canvasSize}
          imageBaseName={imageBaseName}
          patternPx={patternPx}
          transform={transform}
          onTransformUpdate={updateTransform}
          onZoom={scalePattern}
          onRotate={rotatePattern}
          patternOpacity={patternOpacity}
          detectedPoints={detectedPoints}
        />
        <Sidebar
          onConfigLoad={setPattern}
          onCalibrationLoad={setCalibration}
          calibration={calibration}
          onCalibrationChange={setCalibration}
          pattern={pattern}
          onLatticeUpdate={updateLattice}
          onWidthUpdate={updateWidth}
          onHeightUpdate={updateHeight}
          transform={transform}
          onTransformUpdate={updateTransform}
          patternOpacity={patternOpacity}
          onPatternOpacityChange={setPatternOpacity}
          onReset={handleReset}
          hasImage={!!phaseContrast}
          hasDetectedPoints={!!detectedPoints && detectedPoints.length > 0}
          onDetect={handleDetect}
          onFitGrid={handleFitGrid}
        />
      </div>
    </div>
  )
}

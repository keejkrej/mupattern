import { useCallback, useRef, useMemo, useState, useEffect } from "react"
import { Navigate } from "react-router-dom"
import { useStore } from "@tanstack/react-store"
import { AppHeader } from "@/components/AppHeader"
import { LeftSidebar } from "@/register/components/LeftSidebar"
import { Sidebar } from "@/register/components/Sidebar"
import { UnifiedCanvas, type UnifiedCanvasRef } from "@/register/components/UnifiedCanvas"
import { patternToPixels, patternToYAML } from "@/register/lib/units"
import {
  mupatternStore,
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
import { normalizeImageDataForDisplay } from "@/register/lib/normalize"

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
  }, [dataURL])

  return img
}

/** Normalize phase contrast once; returns canvas with mutated (in-place) normalized pixels. Used for display and detection. */
function useNormalizedPhaseContrast(phaseContrast: HTMLImageElement | null): HTMLCanvasElement | null {
  const [normalized, setNormalized] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!phaseContrast) {
      setNormalized(null)
      return
    }
    const canvas = document.createElement("canvas")
    canvas.width = phaseContrast.width
    canvas.height = phaseContrast.height
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(phaseContrast, 0, 0)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    normalizeImageDataForDisplay(imgData)
    ctx.putImageData(imgData, 0, 0)
    setNormalized(canvas)
  }, [phaseContrast])

  return normalized
}

export default function RegisterApp() {
  const canvasRef = useRef<UnifiedCanvasRef>(null)

  useEffect(() => {
    document.title = "Register - MuPattern"
    return () => {
      document.title = "MuPattern"
    }
  }, [])

  const started = useStore(mupatternStore, (s) => s.register.started)
  const imageDataURL = useStore(mupatternStore, (s) => s.register.imageDataURL)
  const imageBaseName = useStore(mupatternStore, (s) => s.register.imageBaseName)
  const canvasSize = useStore(mupatternStore, (s) => s.register.canvasSize)
  const pattern = useStore(mupatternStore, (s) => s.register.pattern)
  const transform = useStore(mupatternStore, (s) => s.register.transform)
  const calibration = useStore(mupatternStore, (s) => s.register.calibration)
  const patternOpacity = useStore(mupatternStore, (s) => s.register.patternOpacity)
  const detectedPoints = useStore(mupatternStore, (s) => s.register.detectedPoints)

  const phaseContrast = useImageFromDataURL(imageDataURL)
  const normalizedPhaseContrast = useNormalizedPhaseContrast(phaseContrast)

  const patternPx = useMemo(
    () => patternToPixels(pattern, calibration),
    [pattern, calibration]
  )

  const handleExportYAML = useCallback(() => {
    const yaml = patternToYAML(pattern, calibration)
    const blob = new Blob([yaml], { type: "text/yaml" })
    const link = document.createElement("a")
    link.download = `${imageBaseName}_config.yaml`
    link.href = URL.createObjectURL(blob)
    link.click()
    URL.revokeObjectURL(link.href)
  }, [pattern, calibration, imageBaseName])

  const handleSaveCSV = useCallback(() => {
    canvasRef.current?.exportCSV()
  }, [])

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

  if (!started) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex h-screen flex-col">
      <AppHeader
        title="Register"
        subtitle="Microscopy pattern-to-image registration"
        backTo="/"
        backLabel="Home"
      />
      <div className="flex flex-1 min-h-0">
        <LeftSidebar
          hasImage={!!phaseContrast}
          hasDetectedPoints={!!detectedPoints && detectedPoints.length > 0}
          onDetect={handleDetect}
          onFitGrid={handleFitGrid}
          onReset={handleReset}
          onSave={handleSaveCSV}
        />
        <UnifiedCanvas
          ref={canvasRef}
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
          onConfigSave={handleExportYAML}
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
        />
      </div>
    </div>
  )
}

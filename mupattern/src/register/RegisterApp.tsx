import { useCallback, useRef, useMemo, useState, useEffect } from "react"
import { useStore } from "@tanstack/react-store"
import { Header } from "@/register/components/Header"
import { Sidebar } from "@/register/components/Sidebar"
import { UnifiedCanvas, type UnifiedCanvasRef } from "@/register/components/UnifiedCanvas"
import { Landing, type StartConfig } from "@/register/components/Landing"
import { patternToPixels, patternToYAML } from "@/register/lib/units"
import {
  appStore,
  startWithImage,
  startFresh,
  loadImage,
  setPattern,
  updateLattice,
  updateWidth,
  updateHeight,
  scalePattern,
  rotatePattern,
  updateTransform,
  setCalibration,
  setSensitivity,
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

/** Convert an HTMLImageElement to a data URL. */
function imageToDataURL(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL("image/png")
}

export default function RegisterApp() {
  const canvasRef = useRef<UnifiedCanvasRef>(null)

  const started = useStore(appStore, (s) => s.started)
  const imageDataURL = useStore(appStore, (s) => s.imageDataURL)
  const imageBaseName = useStore(appStore, (s) => s.imageBaseName)
  const canvasSize = useStore(appStore, (s) => s.canvasSize)
  const pattern = useStore(appStore, (s) => s.pattern)
  const transform = useStore(appStore, (s) => s.transform)
  const calibration = useStore(appStore, (s) => s.calibration)
  const sensitivity = useStore(appStore, (s) => s.sensitivity)
  const detectedPoints = useStore(appStore, (s) => s.detectedPoints)

  const phaseContrast = useImageFromDataURL(imageDataURL)
  const normalizedPhaseContrast = useNormalizedPhaseContrast(phaseContrast)

  const patternPx = useMemo(
    () => patternToPixels(pattern, calibration),
    [pattern, calibration]
  )

  const handleStart = useCallback((config: StartConfig) => {
    if (config.kind === "image") {
      const dataURL = imageToDataURL(config.image)
      startWithImage(dataURL, config.filename, config.image.width, config.image.height)
    } else {
      startFresh(config.width, config.height)
    }
  }, [])

  const handleImageLoad = useCallback((img: HTMLImageElement, filename: string) => {
    const dataURL = imageToDataURL(img)
    loadImage(dataURL, filename, img.width, img.height)
    clearDetectedPoints()
  }, [])

  const handleExportYAML = useCallback(() => {
    const yaml = patternToYAML(pattern, calibration)
    const blob = new Blob([yaml], { type: "text/yaml" })
    const link = document.createElement("a")
    link.download = `${imageBaseName}_config.yaml`
    link.href = URL.createObjectURL(blob)
    link.click()
    URL.revokeObjectURL(link.href)
  }, [pattern, calibration, imageBaseName])

  const handleExport = useCallback(() => {
    canvasRef.current?.exportAll()
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
    return <Landing onStart={handleStart} />
  }

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 min-h-0">
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
          sensitivity={sensitivity}
          onExportYAML={handleExportYAML}
          detectedPoints={detectedPoints}
        />
        <Sidebar
          imageBaseName={phaseContrast ? imageBaseName : null}
          onImageLoad={handleImageLoad}
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
          sensitivity={sensitivity}
          onSensitivityChange={setSensitivity}
          onReset={handleReset}
          onExport={handleExport}
          hasImage={!!phaseContrast}
          hasDetectedPoints={!!detectedPoints && detectedPoints.length > 0}
          onDetect={handleDetect}
          onFitGrid={handleFitGrid}
        />
      </div>
    </div>
  )
}

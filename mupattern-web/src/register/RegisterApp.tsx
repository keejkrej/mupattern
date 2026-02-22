import { useCallback, useRef, useMemo, useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useStore } from "@tanstack/react-store";
import { AppHeader } from "@mupattern/shared";
import { LeftSidebar } from "@/register/components/LeftSidebar";
import { Sidebar } from "@/register/components/Sidebar";
import { UnifiedCanvas, type UnifiedCanvasRef } from "@/register/components/UnifiedCanvas";
import { patternToPixels } from "@mupattern/shared/register/lib/units";
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
} from "@/register/store";
import { detectGridPoints, fitGrid } from "@mupattern/shared/register/lib/autodetect";
import { pixelsToUm } from "@mupattern/shared/register/lib/units";
import { normalizeImageDataForDisplay } from "@mupattern/shared/register/lib/normalize";

/** Normalize phase contrast once; returns canvas. Accepts ImageData (raw pixels) directly. */
function useNormalizedPhaseContrast(rawImageData: ImageData | null): HTMLCanvasElement | null {
  const [normalized, setNormalized] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!rawImageData) {
      setNormalized(null);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = rawImageData.width;
    canvas.height = rawImageData.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(rawImageData, 0, 0);
    const imgData = ctx.getImageData(0, 0, rawImageData.width, rawImageData.height);
    normalizeImageDataForDisplay(imgData);
    ctx.putImageData(imgData, 0, 0);
    setNormalized(canvas);
  }, [rawImageData]);

  return normalized;
}

export default function RegisterApp() {
  const canvasRef = useRef<UnifiedCanvasRef>(null);

  useEffect(() => {
    document.title = "Register - MuPattern";
    return () => {
      document.title = "MuPattern";
    };
  }, []);

  const started = useStore(mupatternStore, (s) => s.register.started);
  const imagePixels = useStore(mupatternStore, (s) => s.register.imagePixels);
  const imageBaseName = useStore(mupatternStore, (s) => s.register.imageBaseName);
  const canvasSize = useStore(mupatternStore, (s) => s.register.canvasSize);
  const pattern = useStore(mupatternStore, (s) => s.register.pattern);
  const transform = useStore(mupatternStore, (s) => s.register.transform);
  const calibration = useStore(mupatternStore, (s) => s.register.calibration);
  const patternOpacity = useStore(mupatternStore, (s) => s.register.patternOpacity);
  const detectedPoints = useStore(mupatternStore, (s) => s.register.detectedPoints);

  const rawImageData = useMemo(
    () =>
      imagePixels
        ? new ImageData(
            new Uint8ClampedArray(imagePixels.rgba),
            imagePixels.width,
            imagePixels.height,
          )
        : null,
    [imagePixels],
  );
  const normalizedPhaseContrast = useNormalizedPhaseContrast(rawImageData);

  const patternPx = useMemo(() => patternToPixels(pattern, calibration), [pattern, calibration]);

  const handleSaveCSV = useCallback(() => {
    canvasRef.current?.exportCSV();
  }, []);

  const handleDetect = useCallback(() => {
    if (!normalizedPhaseContrast) return;
    const points = detectGridPoints(normalizedPhaseContrast, 5);
    if (points.length < 3) {
      alert(
        `Detection found only ${points.length} point(s) — need at least 3. Try a different image.`,
      );
    }
    setDetectedPoints(points);
  }, [normalizedPhaseContrast]);

  const handleFitGrid = useCallback(
    (basisAngle: number) => {
      if (!detectedPoints || detectedPoints.length < 3) return;
      const fit = fitGrid(detectedPoints, canvasSize.width, canvasSize.height, basisAngle);
      if (fit) {
        updateLattice({
          a: pixelsToUm(fit.a, calibration),
          alpha: fit.alpha,
          b: pixelsToUm(fit.b, calibration),
          beta: fit.beta,
        });
        updateTransform({ tx: fit.tx, ty: fit.ty });
      } else {
        alert(
          "Grid fitting failed — no matching lattice directions found. Try the other mode or adjust manually.",
        );
      }
    },
    [detectedPoints, canvasSize, calibration],
  );

  const handleReset = useCallback(() => {
    resetPatternAndTransform();
    clearDetectedPoints();
  }, []);

  if (!started) {
    return <Navigate to="/" replace />;
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
          hasImage={!!rawImageData}
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
  );
}

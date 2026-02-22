import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { AppHeader } from "@mupattern/shared";
import { LeftSliceSidebar } from "@/register/components/LeftSliceSidebar";
import { Sidebar } from "@/register/components/Sidebar";
import { UnifiedCanvas } from "@/register/components/UnifiedCanvas";
import { patternToPixels } from "@mupattern/shared/register/lib/units";
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
} from "@/register/store";
import { detectGridPoints, fitGrid } from "@mupattern/shared/register/lib/autodetect";
import { pixelsToUm } from "@mupattern/shared/register/lib/units";
import { normalizeImageDataForDisplayAsync } from "@/register/lib/normalize"; // mustudio-specific async worker
import { loadImageFromSource, reloadActiveWorkspaceImage } from "@/register/lib/workspace-image";
import { workspaceStore } from "@/workspace/store";

/** Normalize phase contrast once; returns canvas. Accepts ImageData (raw pixels) directly—no blob URL or Image element. */
function useNormalizedPhaseContrast(rawImageData: ImageData | null): HTMLCanvasElement | null {
  const [normalized, setNormalized] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!rawImageData) {
      setNormalized(null);
      return;
    }

    const run = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = rawImageData.width;
      canvas.height = rawImageData.height;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(rawImageData, 0, 0);
      const imgData = ctx.getImageData(0, 0, rawImageData.width, rawImageData.height);
      const normalizedData = await normalizeImageDataForDisplayAsync(imgData);
      if (cancelled) return;
      ctx.putImageData(normalizedData, 0, 0);
      setNormalized(canvas);
    };

    run().catch(() => {
      if (!cancelled) {
        setNormalized(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rawImageData]);

  return normalized;
}

export default function RegisterApp() {
  const imagePixels = useStore(appStore, (s) => s.imagePixels);
  const imageSource = useStore(appStore, (s) => s.imageSource);
  const imageBaseName = useStore(appStore, (s) => s.imageBaseName);
  const canvasSize = useStore(appStore, (s) => s.canvasSize);
  const pattern = useStore(appStore, (s) => s.pattern);
  const transform = useStore(appStore, (s) => s.transform);
  const calibration = useStore(appStore, (s) => s.calibration);
  const patternOpacity = useStore(appStore, (s) => s.patternOpacity);
  const detectedPoints = useStore(appStore, (s) => s.detectedPoints);
  const [workspaceImageError, setWorkspaceImageError] = useState<string | null>(null);
  const hasWorkspace = useStore(
    workspaceStore,
    (s) => !!(s.activeId && s.workspaces.some((w) => w.id === s.activeId)),
  );

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

  // Auto-load image when none is loaded: prefer active workspace (navigate from dashboard), else imageSource (page refresh)
  useEffect(() => {
    if (imagePixels) return;
    const load = async () => {
      if (hasWorkspace) {
        const r = await reloadActiveWorkspaceImage();
        if (r.ok) {
          setWorkspaceImageError(null);
          return;
        }
        setWorkspaceImageError(r.error);
      }
      if (imageSource) {
        const r = await loadImageFromSource(imageSource);
        if (r.ok) setWorkspaceImageError(null);
        else setWorkspaceImageError(r.error);
      }
    };
    void load();
  }, [imagePixels, imageSource, hasWorkspace]);

  const normalizedPhaseContrast = useNormalizedPhaseContrast(rawImageData);

  const patternPx = useMemo(() => patternToPixels(pattern, calibration), [pattern, calibration]);

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

  return (
    <div className="flex h-screen flex-col">
      <AppHeader
        title="Register"
        backTo="/workspace"
      />
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
          hasImage={!!rawImageData}
          hasDetectedPoints={!!detectedPoints && detectedPoints.length > 0}
          onDetect={handleDetect}
          onFitGrid={handleFitGrid}
          onReset={handleReset}
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
        />
      </div>
    </div>
  );
}

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { useTheme } from "@mupattern/shared";
import type { PatternPixels, Transform } from "@mupattern/shared/register/types";
import { normalizeAngleRad } from "@mupattern/shared/register/lib/units";

interface UnifiedCanvasProps {
  /** Pre-normalized phase contrast (canvas); drawn as-is, no per-frame normalization. */
  displayImage: HTMLCanvasElement | null;
  canvasSize: { width: number; height: number };
  imageBaseName: string;
  patternPx: PatternPixels;
  transform: Transform;
  onTransformUpdate: (updates: Partial<Transform>) => void;
  onZoom: (factor: number) => void;
  onRotate: (deltaRad: number) => void;
  patternOpacity: number;
  detectedPoints?: Array<{ x: number; y: number }> | null;
}

export interface UnifiedCanvasRef {
  exportCSV: () => void;
}

const MAX_PREVIEW_RECTS = 12000;
const MAX_PREVIEW_OVERLAP_RECTS = 6000;
const STORE_SYNC_INTERVAL_MS = 50;
const TELEMETRY_WINDOW_MS = 2000;

interface DrawOptions {
  mode: "preview" | "export";
  simplified: boolean;
  maxRects: number | null;
  maxOverlapRects: number | null;
}

interface LatticeDrawStats {
  estimatedRects: number;
  drawnRects: number;
  stride: number;
  capped: boolean;
}

export const UnifiedCanvas = forwardRef<UnifiedCanvasRef, UnifiedCanvasProps>(
  function UnifiedCanvas(
    {
      displayImage,
      canvasSize,
      imageBaseName,
      patternPx,
      transform,
      onTransformUpdate,
      onZoom,
      onRotate,
      patternOpacity,
      detectedPoints,
    },
    ref,
  ) {
    const { theme } = useTheme();
    const canvasRef = useRef<HTMLCanvasElement>(null);

    type DragMode = "none" | "pan" | "rotate" | "resize";
    const dragMode = useRef<DragMode>("none");
    const activePointerId = useRef<number | null>(null);
    const renderRafRef = useRef<number | null>(null);
    const lastPos = useRef({ x: 0, y: 0 });

    const previewTransformRef = useRef<Transform>(transform);
    const previewPatternRef = useRef<PatternPixels>(patternPx);
    const pendingZoomFactorRef = useRef(1);
    const pendingRotateDeltaRef = useRef(0);
    const lastStoreSyncAtRef = useRef(0);

    const frameWindowStartRef = useRef(0);
    const frameCountRef = useRef(0);
    const syncWindowStartRef = useRef(0);
    const syncCountRef = useRef(0);
    const lastDrawStatsRef = useRef<LatticeDrawStats | null>(null);

    const clonePattern = useCallback(
      (pattern: PatternPixels): PatternPixels => ({
        lattice: { ...pattern.lattice },
        width: pattern.width,
        height: pattern.height,
      }),
      [],
    );

    const drawLattice = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        pattern: PatternPixels,
        tx: Transform,
        options: DrawOptions,
      ): LatticeDrawStats => {
        const { lattice, width: rectW, height: rectH } = pattern;
        const vec1 = {
          x: lattice.a * Math.cos(lattice.alpha),
          y: lattice.a * Math.sin(lattice.alpha),
        };
        const vec2 = {
          x: lattice.b * Math.cos(lattice.beta),
          y: lattice.b * Math.sin(lattice.beta),
        };

        const halfW = rectW / 2;
        const halfH = rectH / 2;

        const cx = width / 2;
        const cy = height / 2;

        const minLen = Math.min(
          Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y),
          Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y),
        );
        const maxDim = Math.max(width, height) * 2;
        const maxRange = minLen > 0 ? Math.ceil(maxDim / minLen) + 2 : 20;

        const estimatedRects = Math.pow(maxRange * 2 + 1, 2);
        let stride = 1;
        if (options.maxRects != null && estimatedRects > options.maxRects) {
          stride = Math.max(1, Math.ceil(Math.sqrt(estimatedRects / options.maxRects)));
        }

        ctx.save();
        ctx.translate(cx + tx.tx, cy + tx.ty);

        ctx.fillStyle =
          options.mode === "preview"
            ? `rgba(59, 130, 246, ${Math.max(0, Math.min(1, patternOpacity))})`
            : "#ffffff";

        let drawnRects = 0;
        for (let i = -maxRange; i <= maxRange; i += stride) {
          for (let j = -maxRange; j <= maxRange; j += stride) {
            const x = i * vec1.x + j * vec2.x;
            const y = i * vec1.y + j * vec2.y;

            if (Math.abs(x) > maxDim || Math.abs(y) > maxDim) continue;

            ctx.fillRect(x - halfW, y - halfH, rectW, rectH);
            drawnRects++;
          }
        }

        if (options.mode === "preview" && !options.simplified) {
          const neighborOffsets = [
            { dx: vec1.x, dy: vec1.y },
            { dx: vec2.x, dy: vec2.y },
            { dx: vec1.x + vec2.x, dy: vec1.y + vec2.y },
            { dx: vec1.x - vec2.x, dy: vec1.y - vec2.y },
          ];
          const overlapOffsets = neighborOffsets
            .map(({ dx, dy }) => ({
              dx,
              dy,
              ow: rectW - Math.abs(dx),
              oh: rectH - Math.abs(dy),
            }))
            .filter(({ ow, oh }) => ow > 0 && oh > 0);

          if (overlapOffsets.length > 0) {
            let overlapStride = stride;
            if (options.maxOverlapRects != null) {
              const estimatedOverlapRects = estimatedRects * overlapOffsets.length;
              if (estimatedOverlapRects > options.maxOverlapRects) {
                overlapStride = Math.max(
                  overlapStride,
                  Math.ceil(Math.sqrt(estimatedOverlapRects / options.maxOverlapRects)),
                );
              }
            }

            ctx.fillStyle = "rgba(239, 68, 68, 0.6)";
            for (let i = -maxRange; i <= maxRange; i += overlapStride) {
              for (let j = -maxRange; j <= maxRange; j += overlapStride) {
                const x = i * vec1.x + j * vec2.x;
                const y = i * vec1.y + j * vec2.y;
                if (Math.abs(x) > maxDim || Math.abs(y) > maxDim) continue;

                for (const { dx, dy, ow, oh } of overlapOffsets) {
                  ctx.fillRect(x + dx / 2 - ow / 2, y + dy / 2 - oh / 2, ow, oh);
                }
              }
            }

            if (overlapStride > stride) {
              stride = overlapStride;
            }
          }
        }

        if (options.mode === "preview" && !options.simplified) {
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
          ctx.fill();

          ctx.strokeStyle = "rgba(255, 100, 100, 0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(vec1.x, vec1.y);
          ctx.stroke();
          const a1 = Math.atan2(vec1.y, vec1.x);
          ctx.beginPath();
          ctx.moveTo(vec1.x, vec1.y);
          ctx.lineTo(vec1.x - 8 * Math.cos(a1 - 0.3), vec1.y - 8 * Math.sin(a1 - 0.3));
          ctx.moveTo(vec1.x, vec1.y);
          ctx.lineTo(vec1.x - 8 * Math.cos(a1 + 0.3), vec1.y - 8 * Math.sin(a1 + 0.3));
          ctx.stroke();

          ctx.strokeStyle = "rgba(100, 255, 100, 0.8)";
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(vec2.x, vec2.y);
          ctx.stroke();
          const a2 = Math.atan2(vec2.y, vec2.x);
          ctx.beginPath();
          ctx.moveTo(vec2.x, vec2.y);
          ctx.lineTo(vec2.x - 8 * Math.cos(a2 - 0.3), vec2.y - 8 * Math.sin(a2 - 0.3));
          ctx.moveTo(vec2.x, vec2.y);
          ctx.lineTo(vec2.x - 8 * Math.cos(a2 + 0.3), vec2.y - 8 * Math.sin(a2 + 0.3));
          ctx.stroke();
        }

        ctx.restore();

        if (options.mode === "preview") {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, height);
          ctx.moveTo(0, cy);
          ctx.lineTo(width, cy);
          ctx.stroke();
        }

        return {
          estimatedRects,
          drawnRects,
          stride,
          capped: stride > 1,
        };
      },
      [patternOpacity],
    );

    const flushStoreSync = useCallback(
      (force: boolean) => {
        const now = performance.now();
        if (!force && now - lastStoreSyncAtRef.current < STORE_SYNC_INTERVAL_MS) {
          return;
        }

        switch (dragMode.current) {
          case "pan":
            onTransformUpdate(previewTransformRef.current);
            break;
          case "rotate":
            if (pendingRotateDeltaRef.current !== 0) {
              onRotate(pendingRotateDeltaRef.current);
              pendingRotateDeltaRef.current = 0;
            }
            break;
          case "resize":
            if (pendingZoomFactorRef.current !== 1) {
              onZoom(pendingZoomFactorRef.current);
              pendingZoomFactorRef.current = 1;
            }
            break;
        }

        lastStoreSyncAtRef.current = now;
        syncCountRef.current += 1;
        if (syncWindowStartRef.current === 0) {
          syncWindowStartRef.current = now;
        }
      },
      [onTransformUpdate, onRotate, onZoom],
    );

    const drawFrame = useCallback(
      (timestamp: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.fillStyle = theme === "dark" ? "#262626" : "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (displayImage) {
          ctx.drawImage(displayImage, 0, 0, canvas.width, canvas.height);
        }

        const isDragging = dragMode.current !== "none";
        const activePattern = isDragging ? previewPatternRef.current : patternPx;
        const activeTransform = isDragging ? previewTransformRef.current : transform;

        const stats = drawLattice(
          ctx,
          canvas.width,
          canvas.height,
          activePattern,
          activeTransform,
          {
            mode: "preview",
            simplified: isDragging,
            maxRects: MAX_PREVIEW_RECTS,
            maxOverlapRects: isDragging ? 0 : MAX_PREVIEW_OVERLAP_RECTS,
          },
        );
        lastDrawStatsRef.current = stats;

        if (detectedPoints && detectedPoints.length > 0) {
          ctx.save();
          ctx.strokeStyle = "rgba(0, 255, 100, 0.85)";
          ctx.lineWidth = 2;
          const arm = 5;
          for (const { x, y } of detectedPoints) {
            ctx.beginPath();
            ctx.moveTo(x - arm, y);
            ctx.lineTo(x + arm, y);
            ctx.moveTo(x, y - arm);
            ctx.lineTo(x, y + arm);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (import.meta.env.DEV) {
          if (frameWindowStartRef.current === 0) {
            frameWindowStartRef.current = timestamp;
          }
          frameCountRef.current += 1;

          const dt = timestamp - frameWindowStartRef.current;
          if (dt >= TELEMETRY_WINDOW_MS) {
            const fps = (frameCountRef.current * 1000) / dt;
            const syncStart = syncWindowStartRef.current || timestamp;
            const syncDt = Math.max(1, timestamp - syncStart);
            const syncHz = (syncCountRef.current * 1000) / syncDt;
            const perfStats = lastDrawStatsRef.current;
            console.debug("[Register perf]", {
              fps: Number(fps.toFixed(1)),
              syncHz: Number(syncHz.toFixed(1)),
              estimatedRects: perfStats?.estimatedRects ?? 0,
              drawnRects: perfStats?.drawnRects ?? 0,
              capped: perfStats?.capped ?? false,
              stride: perfStats?.stride ?? 1,
            });
            frameWindowStartRef.current = timestamp;
            frameCountRef.current = 0;
            syncWindowStartRef.current = timestamp;
            syncCountRef.current = 0;
          }
        }
      },
      [theme, displayImage, patternPx, transform, drawLattice, detectedPoints],
    );

    const requestRender = useCallback(() => {
      if (renderRafRef.current !== null) return;
      renderRafRef.current = window.requestAnimationFrame((ts) => {
        renderRafRef.current = null;
        drawFrame(ts);
      });
    }, [drawFrame]);

    useEffect(() => {
      requestRender();
    }, [requestRender]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      requestRender();
    }, [canvasSize, requestRender]);

    useEffect(() => {
      if (dragMode.current !== "none") return;
      previewTransformRef.current = transform;
      previewPatternRef.current = patternPx;
      pendingZoomFactorRef.current = 1;
      pendingRotateDeltaRef.current = 0;
    }, [transform, patternPx]);

    useEffect(() => {
      return () => {
        if (renderRafRef.current !== null) {
          window.cancelAnimationFrame(renderRafRef.current);
          renderRafRef.current = null;
        }
      };
    }, []);

    const exportCSV = useCallback(() => {
      const w = canvasSize.width;
      const h = canvasSize.height;
      const { lattice, width: rectW, height: rectH } = patternPx;

      const vec1 = {
        x: lattice.a * Math.cos(lattice.alpha),
        y: lattice.a * Math.sin(lattice.alpha),
      };
      const vec2 = {
        x: lattice.b * Math.cos(lattice.beta),
        y: lattice.b * Math.sin(lattice.beta),
      };

      const cx = w / 2 + transform.tx;
      const cy = h / 2 + transform.ty;
      const halfW = rectW / 2;
      const halfH = rectH / 2;

      const minLen = Math.min(
        Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y),
        Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y),
      );
      const maxDim = Math.max(w, h) * 2;
      const maxRange = minLen > 0 ? Math.ceil(maxDim / minLen) + 2 : 20;

      const rows: string[] = ["crop,x,y,w,h"];
      let crop = 0;

      for (let i = -maxRange; i <= maxRange; i++) {
        for (let j = -maxRange; j <= maxRange; j++) {
          const px = cx + i * vec1.x + j * vec2.x;
          const py = cy + i * vec1.y + j * vec2.y;
          const bx = px - halfW;
          const by = py - halfH;

          if (bx >= 0 && by >= 0 && bx + rectW <= w && by + rectH <= h) {
            rows.push(
              `${crop},${Math.round(bx)},${Math.round(by)},${Math.round(rectW)},${Math.round(rectH)}`,
            );
            crop++;
          }
        }
      }

      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const link = document.createElement("a");
      link.download = `${imageBaseName}_bbox.csv`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    }, [canvasSize, imageBaseName, patternPx, transform]);

    useImperativeHandle(ref, () => ({ exportCSV }), [exportCSV]);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePointerId.current !== null) return;
        if (e.button === 2) {
          dragMode.current = "rotate";
        } else if (e.button === 1) {
          dragMode.current = "resize";
        } else if (e.button === 0) {
          dragMode.current = "pan";
        } else {
          return;
        }

        activePointerId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        previewTransformRef.current = { ...transform };
        previewPatternRef.current = clonePattern(patternPx);
        pendingZoomFactorRef.current = 1;
        pendingRotateDeltaRef.current = 0;
        lastPos.current = { x: e.clientX, y: e.clientY };
        lastStoreSyncAtRef.current = performance.now();
        requestRender();
      },
      [transform, patternPx, clonePattern, requestRender],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (dragMode.current === "none") return;
        if (activePointerId.current !== e.pointerId) return;

        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        lastPos.current = { x: e.clientX, y: e.clientY };

        switch (dragMode.current) {
          case "rotate": {
            const delta = dx * 0.003;
            pendingRotateDeltaRef.current += delta;
            const lat = previewPatternRef.current.lattice;
            previewPatternRef.current = {
              ...previewPatternRef.current,
              lattice: {
                ...lat,
                alpha: normalizeAngleRad(lat.alpha + delta),
                beta: normalizeAngleRad(lat.beta + delta),
              },
            };
            break;
          }
          case "resize": {
            const factor = Math.max(0.01, 1 + dx * 0.002);
            pendingZoomFactorRef.current *= factor;
            previewPatternRef.current = {
              ...previewPatternRef.current,
              lattice: {
                ...previewPatternRef.current.lattice,
                a: previewPatternRef.current.lattice.a * factor,
                b: previewPatternRef.current.lattice.b * factor,
              },
              width: previewPatternRef.current.width * factor,
              height: previewPatternRef.current.height * factor,
            };
            break;
          }
          case "pan": {
            previewTransformRef.current = {
              tx: previewTransformRef.current.tx + dx,
              ty: previewTransformRef.current.ty + dy,
            };
            break;
          }
        }

        requestRender();
        flushStoreSync(false);
      },
      [requestRender, flushStoreSync],
    );

    const handlePointerUp = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePointerId.current !== e.pointerId) return;

        flushStoreSync(true);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }

        activePointerId.current = null;
        dragMode.current = "none";
        pendingZoomFactorRef.current = 1;
        pendingRotateDeltaRef.current = 0;
        requestRender();
      },
      [flushStoreSync, requestRender],
    );

    const handlePointerCancel = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePointerId.current !== e.pointerId) return;

        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }

        activePointerId.current = null;
        dragMode.current = "none";
        pendingZoomFactorRef.current = 1;
        pendingRotateDeltaRef.current = 0;
        requestRender();
      },
      [requestRender],
    );

    return (
      <div className="flex-1 overflow-auto rounded-lg border border-border bg-muted/30 p-1 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={2048}
          height={2048}
          className="max-w-full max-h-full object-contain cursor-move"
          onPointerDown={(e) => {
            e.preventDefault();
            handlePointerDown(e);
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    );
  },
);

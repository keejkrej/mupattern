import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useStore } from "@tanstack/react-store";
import type { StoreIndex, CropInfo, ZarrStore } from "@/see/lib/zarr";
import { loadFrame, loadMaskFrame, hasMasks } from "@/see/lib/zarr";
import { loadBatchWithRetryOnTotalFailure } from "@/see/lib/frame-loader";
import {
  renderUint16ToCanvas,
  drawSpots,
  drawMaskContours,
} from "@mupattern/shared/see/lib/render";
import { labelMapToContours } from "@mupattern/shared/see/lib/contours";
import {
  type Annotations,
  annotationKey,
  parseKey,
  downloadCSV,
  uploadCSV,
} from "@mupattern/shared/see/lib/annotations";
import { type SpotMap, spotKey, uploadSpotCSV } from "@mupattern/shared/see/lib/spots";
import {
  viewerStore,
  setAnnotations as persistAnnotations,
  setSpots as persistSpots,
  setMasksPath as persistMasksPath,
  setSelectedPos as persistSelectedPos,
  setT as persistT,
  setC as persistC,
  setZ as persistZ,
  setPage as persistPage,
  setContrast as persistContrast,
  setAnnotating as persistAnnotating,
  setShowAnnotations as persistShowAnnotations,
  setShowSpots as persistShowSpots,
  setShowMasks as persistShowMasks,
} from "@/see/store";
import { AppHeader, Slider, Button } from "@mupattern/shared";
import { LeftSliceSidebar } from "@/see/components/LeftSliceSidebar";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Download,
  Upload,
  Pencil,
  Eye,
  EyeOff,
  Crosshair,
  Film,
} from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 9; // 3x3

interface ViewerProps {
  store: ZarrStore;
  index: StoreIndex;
  /** Opens movie task config modal instead of creating with defaults. */
  onSaveAsMovie?: (pos: string, cropId: string) => void;
}

export function Viewer({ store, index, onSaveAsMovie }: ViewerProps) {
  // Persisted state from store
  const selectedPos = useStore(viewerStore, (s) => s.selectedPos);
  const t = useStore(viewerStore, (s) => s.t);
  const c = useStore(viewerStore, (s) => s.c);
  const z = useStore(viewerStore, (s) => s.z);
  const page = useStore(viewerStore, (s) => s.page);
  const contrastMin = useStore(viewerStore, (s) => s.contrastMin);
  const contrastMax = useStore(viewerStore, (s) => s.contrastMax);
  const annotating = useStore(viewerStore, (s) => s.annotating);
  const annotationEntries = useStore(viewerStore, (s) => s.annotations);
  const spotEntries = useStore(viewerStore, (s) => s.spots);
  const showAnnotations = useStore(viewerStore, (s) => s.showAnnotations);
  const showSpots = useStore(viewerStore, (s) => s.showSpots);
  const showMasks = useStore(viewerStore, (s) => s.showMasks);
  const masksPath = useStore(viewerStore, (s) => s.masksPath);

  // Derive annotations Map from persisted entries
  const annotations: Annotations = useMemo(() => new Map(annotationEntries), [annotationEntries]);

  // Derive spots Map from persisted entries
  const spots: SpotMap = useMemo(() => new Map(spotEntries), [spotEntries]);

  // Ephemeral state
  const [playing, setPlaying] = useState(false);
  const [frameLoadError, setFrameLoadError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; crop: CropInfo } | null>(
    null,
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const [workspaceHasMasks, setWorkspaceHasMasks] = useState(false);
  const [autoContrastDone, setAutoContrastDone] = useState(true);

  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshedKeysRef = useRef<Set<string>>(new Set());

  // Validate persisted selectedPos against available positions
  const validPos = index.positions.includes(selectedPos) ? selectedPos : (index.positions[0] ?? "");

  useEffect(() => {
    if (!masksPath) {
      setWorkspaceHasMasks(false);
      return;
    }
    let cancelled = false;
    hasMasks(masksPath).then((v) => {
      if (!cancelled) setWorkspaceHasMasks(v);
    });
    return () => {
      cancelled = true;
    };
  }, [masksPath]);

  // Sync if the persisted pos was invalid
  useEffect(() => {
    if (validPos !== selectedPos) {
      persistSelectedPos(validPos);
    }
  }, [validPos, selectedPos]);

  const crops: CropInfo[] = index.crops.get(validPos) ?? [];
  const maxT = crops.length > 0 ? crops[0].shape[0] - 1 : 0;
  const numChannels = crops.length > 0 ? crops[0].shape[1] : 1;
  const maxZ = crops.length > 0 ? crops[0].shape[2] - 1 : 0;
  const totalPages = Math.ceil(crops.length / PAGE_SIZE);
  const clampedT = Math.min(t, maxT);
  const clampedZ = Math.min(z, maxZ);
  const clampedC = Math.min(c, Math.max(0, numChannels - 1));
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  const pageCrops = crops.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  // Sync clamped values back if needed
  useEffect(() => {
    if (clampedT !== t) persistT(clampedT);
  }, [clampedT, t]);
  useEffect(() => {
    if (clampedC !== c) persistC(clampedC);
  }, [clampedC, c]);
  useEffect(() => {
    if (clampedZ !== z) persistZ(clampedZ);
  }, [clampedZ, z]);
  useEffect(() => {
    if (clampedPage !== page) persistPage(clampedPage);
  }, [clampedPage, page]);

  // Wrapped setters that persist
  const setT = useCallback((v: number) => persistT(v), []);
  const setPage = useCallback((v: number) => persistPage(v), []);
  const setContrastMin = useCallback((v: number) => persistContrast(v, contrastMax), [contrastMax]);
  const setContrastMax = useCallback((v: number) => persistContrast(contrastMin, v), [contrastMin]);
  const setAnnotating = useCallback((v: boolean) => persistAnnotating(v), []);
  const setAnnotations = useCallback((a: Annotations) => persistAnnotations(a), []);
  const setSpots = useCallback((s: SpotMap) => persistSpots(s), []);

  // Playback
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        const curr = viewerStore.state.t;
        persistT(curr >= maxT ? 0 : curr + 1);
      }, 500);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [playing, maxT]);

  // Load visible crops and render
  useEffect(() => {
    let cancelled = false;
    const renderKey = `${validPos}:${clampedT}:${clampedC}:${clampedZ}:${clampedPage}`;

    async function loadPage() {
      const frameResults = await loadBatchWithRetryOnTotalFailure(pageCrops, async (crop) => {
        try {
          return await loadFrame(store, crop.posId, crop.cropId, clampedT, clampedC, clampedZ);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(
            `pos=${crop.posId} crop=${crop.cropId} t=${clampedT} c=${clampedC} z=${clampedZ}: ${msg}`,
          );
        }
      });
      const frames = frameResults.map((r) => r.value);

      if (cancelled) return;
      const firstError = frameResults.find((r) => r.error)?.error ?? null;
      setFrameLoadError(firstError);

      let renderContrastMin = contrastMin;
      let renderContrastMax = contrastMax;

      // Compute auto-contrast from all visible crops combined
      if (!autoContrastDone) {
        const allData: number[] = [];
        for (const f of frames) {
          if (f) {
            for (let i = 0; i < f.data.length; i++) {
              allData.push(f.data[i]);
            }
          }
        }
        if (allData.length > 0) {
          const sorted = new Uint16Array(allData).sort((a, b) => a - b);
          const lo = sorted[Math.floor(sorted.length * 0.001)];
          let hi = sorted[Math.floor(sorted.length * 0.999)];
          if (hi === lo) hi = lo + 1;
          renderContrastMin = lo;
          renderContrastMax = hi;
          persistContrast(lo, hi);
          setAutoContrastDone(true);
        }
      }

      // Render each crop
      for (let i = 0; i < pageCrops.length; i++) {
        const frame = frames[i];
        const canvas = canvasRefs.current.get(canvasKey(pageCrops[i].posId, pageCrops[i].cropId));
        if (!frame || !canvas) continue;
        renderUint16ToCanvas(
          canvas,
          frame.data,
          frame.width,
          frame.height,
          renderContrastMin,
          renderContrastMax,
        );
        // Overlay spots
        if (showSpots) {
          const key = spotKey(validPos, clampedT, pageCrops[i].cropId);
          const cropSpots = spots.get(key);
          if (cropSpots) drawSpots(canvas, cropSpots);
        }
        // Overlay mask contours
        if (showMasks && workspaceHasMasks && masksPath) {
          try {
            const mask = await loadMaskFrame(
              masksPath,
              pageCrops[i].posId,
              pageCrops[i].cropId,
              clampedT,
            );
            const contours = labelMapToContours(mask.data, mask.width, mask.height);
            drawMaskContours(canvas, contours);
          } catch {
            // no mask for this crop or load failed
          }
        }
      }

      // Force one follow-up repaint after initial data fetch for this view key.
      if (!refreshedKeysRef.current.has(renderKey)) {
        refreshedKeysRef.current.add(renderKey);
        requestAnimationFrame(() => {
          if (!cancelled) setRefreshTick((v) => v + 1);
        });
      }
    }

    loadPage();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    store,
    validPos,
    clampedT,
    clampedC,
    clampedZ,
    clampedPage,
    contrastMin,
    contrastMax,
    autoContrastDone,
    spots,
    showSpots,
    showMasks,
    workspaceHasMasks,
    refreshTick,
  ]);

  const setCanvasRef = useCallback(
    (key: string) => (el: HTMLCanvasElement | null) => {
      if (el) {
        canvasRefs.current.set(key, el);
      } else {
        canvasRefs.current.delete(key);
      }
    },
    [],
  );

  const resetAutoContrast = useCallback(() => {
    setAutoContrastDone(false);
  }, []);

  // Annotation handler: click cycles true → false → remove
  const handleAnnotate = useCallback(
    (cropId: string) => {
      const key = annotationKey(validPos, clampedT, cropId);
      const current = annotations.get(key);
      const next = new Map(annotations);
      if (current === undefined) {
        next.set(key, true);
      } else if (current === true) {
        next.set(key, false);
      } else {
        next.delete(key);
      }
      setAnnotations(next);
    },
    [validPos, clampedT, annotations, setAnnotations],
  );

  const handleSave = useCallback(() => {
    downloadCSV(annotations, validPos, `annotations_pos${validPos}.csv`);
  }, [annotations, validPos]);

  const handleLoad = useCallback(async () => {
    try {
      const loaded = await uploadCSV(validPos);
      // Merge with existing annotations (preserving other positions)
      const merged = new Map(annotations);
      for (const [k, v] of loaded) merged.set(k, v);
      setAnnotations(merged);
    } catch {
      // user cancelled
    }
  }, [validPos, annotations, setAnnotations]);

  const handleLoadSpots = useCallback(async () => {
    try {
      const loaded = await uploadSpotCSV(validPos);
      // Merge with existing spots (preserving other positions)
      const merged = new Map(spots);
      for (const [k, v] of loaded) merged.set(k, v);
      setSpots(merged);
    } catch {
      // user cancelled
    }
  }, [validPos, spots, setSpots]);

  const handleLoadMasks = useCallback(async () => {
    try {
      const result = await window.mupatternDesktop.zarr.pickMasksDirectory();
      if (result) persistMasksPath(result.path);
    } catch (e) {
      setFrameLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleSaveAsMovie = useCallback(
    (crop: CropInfo) => {
      setContextMenu(null);
      if (onSaveAsMovie) {
        onSaveAsMovie(validPos, crop.cropId);
        return;
      }
      if (!store.workspacePath) {
        toast.error("No workspace path");
        return;
      }
      toast.error("Movie task config unavailable");
    },
    [store.workspacePath, validPos, onSaveAsMovie],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-context-menu]")) return;
      setContextMenu(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // Build set of cropIds that have any annotation (at any timepoint) for current position
  const annotatedCrops = useMemo(() => {
    const s = new Set<string>();
    for (const [key] of annotations) {
      const { pos, cropId } = parseKey(key);
      if (pos === validPos) s.add(cropId);
    }
    return s;
  }, [annotations, validPos]);

  // Border color for annotation state (only when visible)
  function borderClass(cropId: string): string {
    if (!showAnnotations) return "";
    const key = annotationKey(validPos, clampedT, cropId);
    const label = annotations.get(key);
    if (label === true) return "ring-2 ring-blue-500";
    if (label === false) return "ring-2 ring-red-500";
    if (annotatedCrops.has(cropId)) return "ring-2 ring-green-500";
    return "";
  }

  // Count spots visible at current timepoint
  const spotCount = useMemo(() => {
    let count = 0;
    for (const [key, list] of spots) {
      const [pos, tStr] = key.split(":");
      if (pos === validPos && parseInt(tStr, 10) === clampedT) count += list.length;
    }
    return count;
  }, [spots, validPos, clampedT]);

  return (
    <div className="flex flex-col h-screen">
      <AppHeader title="See" subtitle="Micropattern crop viewer" backTo="/workspace" />
      {frameLoadError && (
        <div className="px-4 py-2 text-xs text-destructive border-b border-border">
          {frameLoadError}
        </div>
      )}

      {/* Main area: crop grid + sidebars */}
      <div className="flex flex-1 overflow-hidden">
        <LeftSliceSidebar />
        {/* Crop grid with contrast above */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="shrink-0 grid grid-cols-3 items-center gap-4 px-4 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={clampedPage === 0}
                onClick={() => setPage(clampedPage - 1)}
                title="Previous page"
              >
                <ChevronLeft className="size-3" />
              </Button>
              <span className="text-sm tabular-nums min-w-[4rem] text-center">
                {clampedPage + 1} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={clampedPage >= totalPages - 1}
                onClick={() => setPage(clampedPage + 1)}
                title="Next page"
              >
                <ChevronRight className="size-3" />
              </Button>
            </div>
            <div className="flex items-center gap-2 text-sm justify-self-center">
              <span className="text-muted-foreground">Contrast:</span>
              <input
                type="number"
                value={contrastMin}
                onChange={(e) => setContrastMin(Number(e.target.value))}
                className="w-20 bg-secondary text-center rounded px-1 py-0.5 text-sm"
              />
              <span>-</span>
              <input
                type="number"
                value={contrastMax}
                onChange={(e) => setContrastMax(Number(e.target.value))}
                className="w-20 bg-secondary text-center rounded px-1 py-0.5 text-sm"
              />
              <Button variant="outline" size="xs" className="text-sm" onClick={resetAutoContrast}>
                Auto
              </Button>
            </div>
            <span className="text-sm tabular-nums whitespace-nowrap justify-self-end">
              t = {clampedT} / {maxT}
            </span>
          </div>
          {/* Frame control */}
          <div className="shrink-0 border-b border-border flex flex-col gap-2 px-4 py-2">
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setT(0)}
                disabled={clampedT === 0}
                title="First frame"
              >
                <SkipBack className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setT(Math.max(0, clampedT - 10))}
                disabled={clampedT === 0}
                title="-10 frames"
              >
                <ChevronsLeft className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setT(Math.max(0, clampedT - 1))}
                disabled={clampedT === 0}
                title="Previous frame"
              >
                <ChevronLeft className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setPlaying(!playing)}
                title={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setT(Math.min(maxT, clampedT + 1))}
                disabled={clampedT >= maxT}
                title="Next frame"
              >
                <ChevronRight className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setT(Math.min(maxT, clampedT + 10))}
                disabled={clampedT >= maxT}
                title="+10 frames"
              >
                <ChevronsRight className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setT(maxT)}
                disabled={clampedT >= maxT}
                title="Last frame"
              >
                <SkipForward className="size-3" />
              </Button>
            </div>
            <Slider
              min={0}
              max={maxT}
              value={[clampedT]}
              onValueChange={([v]) => setT(v)}
              className="w-full"
            />
          </div>
          <div className="flex-1 overflow-hidden p-4 min-h-0">
            <div className="grid grid-cols-3 grid-rows-3 gap-2 h-full">
              {pageCrops.map((crop) => (
                <div
                  key={canvasKey(crop.posId, crop.cropId)}
                  className={`relative rounded-sm ${annotating ? "cursor-crosshair" : ""} ${borderClass(crop.cropId)}`}
                  onClick={annotating ? () => handleAnnotate(crop.cropId) : undefined}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, crop });
                  }}
                >
                  <canvas
                    ref={setCanvasRef(canvasKey(crop.posId, crop.cropId))}
                    className="block w-full h-full object-contain"
                    style={{ imageRendering: "pixelated" }}
                  />
                  <div className="absolute bottom-0 left-0 px-1 text-[10px] bg-black/60 text-white">
                    {crop.cropId}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right sidebar: overlays */}
        <aside className="w-64 flex-shrink-0 border-l border-border p-3 flex flex-col gap-4 text-sm overflow-y-auto">
          {/* Annotations section */}
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-xs uppercase text-muted-foreground tracking-wide">
              Annotations
            </h3>
            <Button
              variant={annotating ? "default" : "ghost"}
              size="xs"
              className="justify-start"
              onClick={() => setAnnotating(!annotating)}
              title="Toggle annotation mode"
            >
              <Pencil className="size-3" />
              {annotating ? "Annotating" : "Annotate"}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleLoad}
                title="Load annotations CSV"
              >
                <Upload className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleSave}
                title="Save annotations CSV"
                disabled={annotations.size === 0}
              >
                <Download className="size-3.5" />
              </Button>
              <span className="text-muted-foreground tabular-nums text-xs">
                {annotations.size} labeled
              </span>
            </div>
            {annotations.size > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="justify-start"
                onClick={() => persistShowAnnotations(!showAnnotations)}
              >
                {showAnnotations ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                {showAnnotations ? "Visible" : "Hidden"}
              </Button>
            )}
          </div>

          <div className="h-px bg-border" />

          {/* Spots section */}
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-xs uppercase text-muted-foreground tracking-wide">
              Spots
            </h3>
            <Button
              variant="ghost"
              size="xs"
              className="justify-start"
              onClick={handleLoadSpots}
              title="Load spots CSV"
            >
              <Crosshair className="size-3" />
              Load CSV
            </Button>
            {spots.size > 0 && (
              <>
                <span className="text-muted-foreground tabular-nums text-xs">
                  {spotCount} spots (t={clampedT})
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="justify-start"
                  onClick={() => persistShowSpots(!showSpots)}
                >
                  {showSpots ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                  {showSpots ? "Visible" : "Hidden"}
                </Button>
              </>
            )}
          </div>

          <div className="h-px bg-border" />
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-xs uppercase text-muted-foreground tracking-wide">
              Masks
            </h3>
            <Button
              variant="ghost"
              size="xs"
              className="justify-start"
              onClick={handleLoadMasks}
              title="Load masks zarr folder"
            >
              <Upload className="size-3.5" />
              Load
            </Button>
            {masksPath != null && (
              <>
                <div className="flex items-center gap-1">
                  <p
                    className="text-xs text-muted-foreground truncate flex-1 min-w-0"
                    title={masksPath}
                  >
                    {masksPath.split(/[/\\]/).filter(Boolean).pop() ?? "Masks"}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => persistMasksPath(null)}
                    title="Clear masks"
                  >
                    ×
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  className="justify-start"
                  onClick={() => persistShowMasks(!showMasks)}
                  title="Toggle mask contours"
                >
                  {showMasks ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                  {showMasks ? "Contours visible" : "Contours hidden"}
                </Button>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* Crop context menu */}
      {contextMenu && (
        <div
          data-context-menu
          className="fixed z-50 border rounded bg-background shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="w-full text-left px-4 py-2 hover:bg-accent text-sm flex items-center gap-2"
            onClick={() => handleSaveAsMovie(contextMenu.crop)}
          >
            <Film className="size-4" />
            Save as movie
          </button>
        </div>
      )}
    </div>
  );
}
function canvasKey(posId: string, cropId: string): string {
  return `${posId}:${cropId}`;
}

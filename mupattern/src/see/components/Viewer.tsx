import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useStore } from "@tanstack/react-store";
import type { DirectoryStore } from "@/see/lib/directory-store";
import type { StoreIndex, CropInfo } from "@/see/lib/zarr";
import { loadFrame } from "@/see/lib/zarr";
import { renderUint16ToCanvas, drawSpots } from "@/see/lib/render";
import {
  type Annotations,
  annotationKey,
  parseKey,
  downloadCSV,
  uploadCSV,
} from "@/see/lib/annotations";
import { type SpotMap, spotKey, uploadSpotCSV } from "@/see/lib/spots";
import {
  mupatternStore,
  setAnnotations as persistAnnotations,
  setSpots as persistSpots,
  setSelectedPos as persistSelectedPos,
  setT as persistT,
  setC as persistC,
  setPage as persistPage,
  setContrast as persistContrast,
  setAnnotating as persistAnnotating,
  setShowAnnotations as persistShowAnnotations,
  setShowSpots as persistShowSpots,
} from "@/see/store";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { LeftSidebar } from "@/see/components/LeftSidebar";

const PAGE_SIZE = 9; // 3x3

interface ViewerProps {
  store: DirectoryStore;
  index: StoreIndex;
}

export function Viewer({ store, index }: ViewerProps) {

  // Persisted state from central store
  const selectedPos = useStore(mupatternStore, (s) => s.see.selectedPos);
  const t = useStore(mupatternStore, (s) => s.see.t);
  const c = useStore(mupatternStore, (s) => s.see.c);
  const page = useStore(mupatternStore, (s) => s.see.page);
  const contrastMin = useStore(mupatternStore, (s) => s.see.contrastMin);
  const contrastMax = useStore(mupatternStore, (s) => s.see.contrastMax);
  const annotating = useStore(mupatternStore, (s) => s.see.annotating);
  const annotationEntries = useStore(mupatternStore, (s) => s.see.annotations);
  const spotEntries = useStore(mupatternStore, (s) => s.see.spots);
  const showAnnotations = useStore(mupatternStore, (s) => s.see.showAnnotations);
  const showSpots = useStore(mupatternStore, (s) => s.see.showSpots);

  // Derive annotations Map from persisted entries
  const annotations: Annotations = useMemo(
    () => new Map(annotationEntries),
    [annotationEntries]
  );

  // Derive spots Map from persisted entries
  const spots: SpotMap = useMemo(
    () => new Map(spotEntries),
    [spotEntries]
  );

  // Ephemeral state
  const [playing, setPlaying] = useState(false);
  const [autoContrastDone, setAutoContrastDone] = useState(
    // If we have persisted contrast values that aren't defaults, skip auto
    contrastMin !== 0 || contrastMax !== 65535
  );

  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Validate persisted selectedPos against available positions
  const validPos = index.positions.includes(selectedPos)
    ? selectedPos
    : index.positions[0] ?? "";

  // Sync if the persisted pos was invalid
  useEffect(() => {
    if (validPos !== selectedPos) {
      persistSelectedPos(validPos);
    }
  }, [validPos, selectedPos]);

  const crops: CropInfo[] = index.crops.get(validPos) ?? [];
  const maxT = crops.length > 0 ? crops[0].shape[0] - 1 : 0;
  const numChannels = crops.length > 0 ? crops[0].shape[1] : 1;
  const totalPages = Math.ceil(crops.length / PAGE_SIZE);
  const clampedT = Math.min(t, maxT);
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  const pageCrops = crops.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  // Sync clamped values back if needed
  useEffect(() => {
    if (clampedT !== t) persistT(clampedT);
  }, [clampedT, t]);
  useEffect(() => {
    if (clampedPage !== page) persistPage(clampedPage);
  }, [clampedPage, page]);

  // Wrapped setters that persist
  const setT = useCallback((v: number) => persistT(v), []);
  const setPage = useCallback((v: number) => persistPage(v), []);
  const setContrastMin = useCallback(
    (v: number) => persistContrast(v, contrastMax),
    [contrastMax]
  );
  const setContrastMax = useCallback(
    (v: number) => persistContrast(contrastMin, v),
    [contrastMin]
  );
  const setAnnotating = useCallback((v: boolean) => persistAnnotating(v), []);
  const setAnnotations = useCallback(
    (a: Annotations) => persistAnnotations(a),
    []
  );
  const setSpots = useCallback(
    (s: SpotMap) => persistSpots(s),
    []
  );

  // Playback
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        const curr = mupatternStore.state.see.t;
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

    async function loadPage() {
      const frames = await Promise.all(
        pageCrops.map((crop) =>
          loadFrame(store, crop.posId, crop.cropId, clampedT, c).catch(() => null)
        )
      );

      if (cancelled) return;

      // Compute auto-contrast from all visible crops combined
      if (!autoContrastDone) {
        const allData: number[] = [];
        for (const f of frames) {
          if (f) {
            for (let i = 0; i < f.data.length; i += 4) {
              allData.push(f.data[i]);
            }
          }
        }
        if (allData.length > 0) {
          const sorted = new Uint16Array(allData).sort();
          const lo = sorted[Math.floor(sorted.length * 0.02)];
          const hi = sorted[Math.floor(sorted.length * 0.98)];
          persistContrast(lo, hi);
          setAutoContrastDone(true);
        }
      }

      // Render each crop
      for (let i = 0; i < pageCrops.length; i++) {
        const frame = frames[i];
        const canvas = canvasRefs.current.get(pageCrops[i].cropId);
        if (!frame || !canvas) continue;
        renderUint16ToCanvas(
          canvas,
          frame.data,
          frame.width,
          frame.height,
          contrastMin,
          contrastMax
        );
        // Overlay spots
        if (showSpots) {
          const key = spotKey(validPos, clampedT, pageCrops[i].cropId);
          const cropSpots = spots.get(key);
          if (cropSpots) drawSpots(canvas, cropSpots);
        }
      }
    }

    loadPage();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, validPos, clampedT, c, clampedPage, contrastMin, contrastMax, autoContrastDone, spots, showSpots]);

  const setCanvasRef = useCallback(
    (cropId: string) => (el: HTMLCanvasElement | null) => {
      if (el) {
        canvasRefs.current.set(cropId, el);
      } else {
        canvasRefs.current.delete(cropId);
      }
    },
    []
  );

  const resetAutoContrast = useCallback(() => {
    setAutoContrastDone(false);
  }, []);

  const handleChangePos = useCallback((posId: string) => {
    persistSelectedPos(posId);
    setAutoContrastDone(false);
  }, []);

  const handleChangeChannel = useCallback((ch: number) => {
    persistC(ch);
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
    [validPos, clampedT, annotations, setAnnotations]
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
      <AppHeader
        title="See"
        subtitle="Micropattern crop viewer"
        backTo="/"
        backLabel="Home"
      />

      {/* Slider row */}
      <div className="px-4 py-1 border-b">
        <Slider
          min={0}
          max={maxT}
          value={[clampedT]}
          onValueChange={([v]) => setT(v)}
        />
      </div>

      {/* Frame controls + contrast */}
      <div className="flex items-center justify-center gap-3 px-4 py-2 border-b">
        <Button variant="ghost" size="icon-xs" onClick={() => setT(0)} disabled={clampedT === 0}>
          <SkipBack className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => setT(Math.max(0, clampedT - 10))} disabled={clampedT === 0}>
          <ChevronsLeft className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => setT(Math.max(0, clampedT - 1))} disabled={clampedT === 0}>
          <ChevronLeft className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => setPlaying(!playing)}>
          {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => setT(Math.min(maxT, clampedT + 1))} disabled={clampedT >= maxT}>
          <ChevronRight className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => setT(Math.min(maxT, clampedT + 10))} disabled={clampedT >= maxT}>
          <ChevronsRight className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => setT(maxT)} disabled={clampedT >= maxT}>
          <SkipForward className="size-3" />
        </Button>

        <span className="text-sm tabular-nums whitespace-nowrap">
          t = {clampedT} / {maxT}
        </span>

        <div className="mx-2 h-4 w-px bg-border" />

        <div className="flex items-center gap-2 text-sm">
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
          <button
            onClick={resetAutoContrast}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Auto
          </button>
        </div>
      </div>

      {/* Main area: left sidebar + crop grid + right sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar
          positions={index.positions}
          validPos={validPos}
          onPositionChange={handleChangePos}
          numChannels={numChannels}
          channel={c}
          onChannelChange={handleChangeChannel}
        />
        {/* Crop grid */}
        <div className="flex-1 overflow-hidden p-4">
          <div className="grid grid-cols-3 grid-rows-3 gap-2 h-full">
            {pageCrops.map((crop) => (
              <div
                key={crop.cropId}
                className={`relative rounded-sm ${annotating ? "cursor-crosshair" : ""} ${borderClass(crop.cropId)}`}
                onClick={annotating ? () => handleAnnotate(crop.cropId) : undefined}
              >
                <canvas
                  ref={setCanvasRef(crop.cropId)}
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

        {/* Right sidebar: overlays */}
        <aside className="w-48 border-l border-border p-3 flex flex-col gap-4 text-sm overflow-y-auto">
          {/* Annotations section */}
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-xs uppercase text-muted-foreground tracking-wide">Annotations</h3>
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
              <Button variant="ghost" size="icon-xs" onClick={handleLoad} title="Load annotations CSV">
                <Upload className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={handleSave} title="Save annotations CSV" disabled={annotations.size === 0}>
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
            <h3 className="font-medium text-xs uppercase text-muted-foreground tracking-wide">Spots</h3>
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
        </aside>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-4 px-4 py-2 border-t">
        <span className="text-sm text-muted-foreground">
          {crops.length} crops
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-xs" disabled={clampedPage === 0} onClick={() => setPage(0)}>
            <SkipBack className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>
            <ChevronLeft className="size-3" />
          </Button>
          <span className="text-sm tabular-nums">
            Page {clampedPage + 1} / {totalPages}
          </span>
          <Button variant="ghost" size="icon-xs" disabled={clampedPage >= totalPages - 1} onClick={() => setPage(clampedPage + 1)}>
            <ChevronRight className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" disabled={clampedPage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
            <SkipForward className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useStore } from "@tanstack/react-store";
import type { DirectoryStore } from "@/see/lib/directory-store";
import type { StoreIndex, CropInfo } from "@/see/lib/zarr";
import { loadFrame } from "@/see/lib/zarr";
import { renderUint16ToCanvas } from "@mupattern/shared/see/lib/render";
import {
  type Annotations,
  annotationKey,
  parseKey,
  downloadCSV,
  uploadCSV,
} from "@mupattern/shared/see/lib/annotations";
import {
  mupatternStore,
  setAnnotations as persistAnnotations,
  setSelectedPos as persistSelectedPos,
  setT as persistT,
  setC as persistC,
  setZ as persistZ,
  setPage as persistPage,
  setContrast as persistContrast,
  setAnnotating as persistAnnotating,
  setShowAnnotations as persistShowAnnotations,
} from "@/see/store";
import { Slider, Button, AppHeader } from "@mupattern/shared";
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
} from "lucide-react";
import { LeftSidebar } from "@/see/components/LeftSidebar";

const PAGE_SIZE = 9;

interface ViewerProps {
  store: DirectoryStore;
  index: StoreIndex;
}

export function Viewer({ store, index }: ViewerProps) {
  const selectedPos = useStore(mupatternStore, (s) => s.see.selectedPos);
  const t = useStore(mupatternStore, (s) => s.see.t);
  const c = useStore(mupatternStore, (s) => s.see.c);
  const z = useStore(mupatternStore, (s) => s.see.z);
  const page = useStore(mupatternStore, (s) => s.see.page);
  const contrastMin = useStore(mupatternStore, (s) => s.see.contrastMin);
  const contrastMax = useStore(mupatternStore, (s) => s.see.contrastMax);
  const annotating = useStore(mupatternStore, (s) => s.see.annotating);
  const annotationEntries = useStore(mupatternStore, (s) => s.see.annotations);
  const showAnnotations = useStore(mupatternStore, (s) => s.see.showAnnotations);

  const annotations: Annotations = useMemo(() => new Map(annotationEntries), [annotationEntries]);

  const [playing, setPlaying] = useState(false);
  const [autoContrastDone, setAutoContrastDone] = useState(true);

  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const validPos = index.positions.includes(selectedPos) ? selectedPos : (index.positions[0] ?? "");

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

  const setT = useCallback((value: number) => persistT(value), []);
  const setPage = useCallback((value: number) => persistPage(value), []);
  const setContrastMin = useCallback((value: number) => persistContrast(value, contrastMax), [contrastMax]);
  const setContrastMax = useCallback((value: number) => persistContrast(contrastMin, value), [contrastMin]);
  const setAnnotating = useCallback((value: boolean) => persistAnnotating(value), []);
  const setAnnotations = useCallback((value: Annotations) => persistAnnotations(value), []);

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

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      const frames = await Promise.all(
        pageCrops.map((crop) =>
          loadFrame(store, crop.posId, crop.cropId, clampedT, clampedC, clampedZ).catch(
            () => null,
          ),
        ),
      );

      if (cancelled) return;

      let renderContrastMin = contrastMin;
      let renderContrastMax = contrastMax;

      if (!autoContrastDone) {
        const allData: number[] = [];
        for (const frame of frames) {
          if (!frame) continue;
          for (let i = 0; i < frame.data.length; i += 1) {
            allData.push(frame.data[i]);
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

      for (let i = 0; i < pageCrops.length; i += 1) {
        const frame = frames[i];
        const crop = pageCrops[i];
        const canvas = canvasRefs.current.get(canvasKey(crop.posId, crop.cropId));
        if (!frame || !canvas) continue;
        renderUint16ToCanvas(
          canvas,
          frame.data,
          frame.width,
          frame.height,
          renderContrastMin,
          renderContrastMax,
        );
      }
    }

    void loadPage();
    return () => {
      cancelled = true;
    };
  }, [
    store,
    pageCrops,
    clampedT,
    clampedC,
    clampedZ,
    contrastMin,
    contrastMax,
    autoContrastDone,
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

  const handleChangePos = useCallback((posId: string) => {
    persistSelectedPos(posId);
    setAutoContrastDone(false);
  }, []);

  const handleChangeChannel = useCallback((ch: number) => {
    persistC(ch);
    setAutoContrastDone(false);
  }, []);

  const handleChangeZ = useCallback((value: number) => {
    persistZ(value);
    setAutoContrastDone(false);
  }, []);

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
      const merged = new Map(annotations);
      for (const [key, value] of loaded) merged.set(key, value);
      setAnnotations(merged);
    } catch {
      // user cancelled
    }
  }, [validPos, annotations, setAnnotations]);

  const annotatedCrops = useMemo(() => {
    const cropsWithAnnotations = new Set<string>();
    for (const [key] of annotations) {
      const { pos, cropId } = parseKey(key);
      if (pos === validPos) cropsWithAnnotations.add(cropId);
    }
    return cropsWithAnnotations;
  }, [annotations, validPos]);

  function borderClass(cropId: string): string {
    if (!showAnnotations) return "";
    const key = annotationKey(validPos, clampedT, cropId);
    const label = annotations.get(key);
    if (label === true) return "ring-2 ring-blue-500";
    if (label === false) return "ring-2 ring-red-500";
    if (annotatedCrops.has(cropId)) return "ring-2 ring-green-500";
    return "";
  }

  return (
    <div className="flex flex-col h-screen">
      <AppHeader title="See" backTo="/tools" backLabel="Tools" />

      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar
          positions={index.positions}
          validPos={validPos}
          onPositionChange={handleChangePos}
          numChannels={numChannels}
          channel={clampedC}
          onChannelChange={handleChangeChannel}
          maxZ={maxZ}
          z={clampedZ}
          onZChange={handleChangeZ}
        />
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
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
              onValueChange={([value]) => setT(value)}
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

        <aside className="w-64 flex-shrink-0 border-l border-border p-3 flex flex-col gap-4 text-sm overflow-y-auto">
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
              <Button variant="ghost" size="icon-xs" onClick={handleLoad} title="Load annotations CSV">
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
        </aside>
      </div>
    </div>
  );
}

function canvasKey(posId: string, cropId: string): string {
  return `${posId}:${cropId}`;
}

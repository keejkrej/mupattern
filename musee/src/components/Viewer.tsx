import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useStore } from "@tanstack/react-store";
import type { DirectoryStore } from "@/lib/directory-store";
import type { StoreIndex, CropInfo } from "@/lib/zarr";
import { loadFrame } from "@/lib/zarr";
import { renderUint16ToCanvas } from "@/lib/render";
import {
  type Annotations,
  annotationKey,
  parseKey,
  downloadCSV,
  uploadCSV,
} from "@/lib/annotations";
import {
  viewerStore,
  setAnnotations as persistAnnotations,
  setSelectedPos as persistSelectedPos,
  setT as persistT,
  setC as persistC,
  setPage as persistPage,
  setContrast as persistContrast,
  setAnnotating as persistAnnotating,
} from "@/store";
import { Slider } from "@mupattern/ui/components/ui/slider";
import { Button } from "@mupattern/ui/components/ui/button";
import { Switch } from "@mupattern/ui/components/ui/switch";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Sun,
  Moon,
  Download,
  Upload,
  Pencil,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";

const PAGE_SIZE = 25; // 5x5

interface ViewerProps {
  store: DirectoryStore;
  index: StoreIndex;
}

export function Viewer({ store, index }: ViewerProps) {
  const { theme, toggleTheme } = useTheme();

  // Persisted state from store
  const selectedPos = useStore(viewerStore, (s) => s.selectedPos);
  const t = useStore(viewerStore, (s) => s.t);
  const c = useStore(viewerStore, (s) => s.c);
  const page = useStore(viewerStore, (s) => s.page);
  const contrastMin = useStore(viewerStore, (s) => s.contrastMin);
  const contrastMax = useStore(viewerStore, (s) => s.contrastMax);
  const annotating = useStore(viewerStore, (s) => s.annotating);
  const annotationEntries = useStore(viewerStore, (s) => s.annotations);

  // Derive annotations Map from persisted entries
  const annotations: Annotations = useMemo(
    () => new Map(annotationEntries),
    [annotationEntries]
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
      }
    }

    loadPage();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, validPos, clampedT, c, clampedPage, contrastMin, contrastMax, autoContrastDone]);

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
      const key = annotationKey(clampedT, cropId);
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
    [clampedT, annotations, setAnnotations]
  );

  const handleSave = useCallback(() => {
    downloadCSV(annotations, `annotations_pos${validPos}.csv`);
  }, [annotations, validPos]);

  const handleLoad = useCallback(async () => {
    try {
      const loaded = await uploadCSV();
      setAnnotations(loaded);
    } catch {
      // user cancelled
    }
  }, [setAnnotations]);

  // Build set of cropIds that have any annotation (at any timepoint)
  const annotatedCrops = useMemo(() => {
    const s = new Set<string>();
    for (const [key] of annotations) {
      const { cropId } = parseKey(key);
      s.add(cropId);
    }
    return s;
  }, [annotations]);

  // Border color for annotation state
  function borderClass(cropId: string): string {
    const key = annotationKey(clampedT, cropId);
    const label = annotations.get(key);
    if (label === true) return "ring-2 ring-blue-500";
    if (label === false) return "ring-2 ring-red-500";
    if (annotatedCrops.has(cropId)) return "ring-2 ring-green-500";
    return "";
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h1
            className="text-4xl tracking-tight"
            style={{ fontFamily: '"Bitcount", monospace' }}
          >
            MuSee
          </h1>
          <p className="text-base text-muted-foreground">
            Micropattern crop viewer
          </p>
        </div>
        <div className="flex items-center gap-6">
          {index.positions.length > 1 && (
            <select
              value={validPos}
              onChange={(e) => handleChangePos(e.target.value)}
              className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-sm"
            >
              {index.positions.map((p) => (
                <option key={p} value={p}>
                  Pos {p}
                </option>
              ))}
            </select>
          )}
          <select
            value={c}
            onChange={(e) => handleChangeChannel(Number(e.target.value))}
            className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-sm"
          >
            {Array.from({ length: numChannels }, (_, i) => (
              <option key={i} value={i}>
                Ch {i}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">
            {crops.length} crops
          </span>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            variant={annotating ? "default" : "ghost"}
            size="xs"
            onClick={() => setAnnotating(!annotating)}
            title="Toggle annotation mode"
          >
            <Pencil className="size-3" />
            {annotating ? "Annotating" : "Annotate"}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {annotations.size} labeled
          </span>
          <Button variant="ghost" size="icon-xs" onClick={handleLoad} title="Load annotations CSV">
            <Upload className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={handleSave} title="Save annotations CSV" disabled={annotations.size === 0}>
            <Download className="size-3.5" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Sun className="size-3.5 text-muted-foreground" />
            <Switch
              checked={theme === "dark"}
              onCheckedChange={toggleTheme}
              aria-label="Toggle dark mode"
            />
            <Moon className="size-3.5 text-muted-foreground" />
          </div>
        </div>
      </header>

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

      {/* Crop grid */}
      <div className="flex-1 overflow-hidden p-4">
        <div className="grid grid-cols-5 grid-rows-5 gap-2 h-full">
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

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2 px-4 py-2 border-t">
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
  );
}

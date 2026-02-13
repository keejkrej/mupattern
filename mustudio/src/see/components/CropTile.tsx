import { useEffect, useRef, useState, memo } from "react";
import { loadFrame, type ZarrStore } from "@/see/lib/zarr";
import { renderUint16ToCanvas, autoContrast } from "@/see/lib/render";
import type { CropInfo } from "@/see/lib/zarr";

interface CropTileProps {
  store: ZarrStore;
  crop: CropInfo;
  t: number;
  contrastMin: number | null;
  contrastMax: number | null;
  onAutoContrast?: (min: number, max: number) => void;
  selected?: boolean;
  onClick?: () => void;
}

export const CropTile = memo(function CropTile({
  store,
  crop,
  t,
  contrastMin,
  contrastMax,
  onAutoContrast,
  selected,
  onClick,
}: CropTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const frame = await loadFrame(store, crop.posId, crop.cropId, t);
        if (cancelled) return;

        if (crop.cropId === "000") {
          const d = frame.data;
          let mn = d[0], mx = d[0];
          for (let i = 1; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
          console.log(`crop 000 t=${t}: len=${d.length} w=${frame.width} h=${frame.height} min=${mn} max=${mx} contrast=[${contrastMin},${contrastMax}]`);
        }

        // Auto-contrast on first load if not yet set
        if (contrastMin === null || contrastMax === null) {
          const [lo, hi] = autoContrast(frame.data);
          onAutoContrast?.(lo, hi);
          if (canvasRef.current) {
            renderUint16ToCanvas(
              canvasRef.current,
              frame.data,
              frame.width,
              frame.height,
              lo,
              hi
            );
          }
        } else if (canvasRef.current) {
          renderUint16ToCanvas(
            canvasRef.current,
            frame.data,
            frame.width,
            frame.height,
            contrastMin,
            contrastMax
          );
        }
      } catch (e) {
        console.error(`Failed to load crop ${crop.cropId} t=${t}`, e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [store, crop.posId, crop.cropId, t, contrastMin, contrastMax, onAutoContrast]);

  return (
    <div
      className={`relative cursor-pointer border-2 transition-colors ${
        selected
          ? "border-primary"
          : "border-transparent hover:border-muted-foreground/30"
      }`}
      onClick={onClick}
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-auto"
        style={{ imageRendering: "pixelated" }}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 px-1 text-[10px] bg-black/60 text-white">
        {crop.cropId}
      </div>
    </div>
  );
});

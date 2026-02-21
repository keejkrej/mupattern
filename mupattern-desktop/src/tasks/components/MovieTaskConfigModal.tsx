import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
} from "@mupattern/shared";
import { discoverStore } from "@/see/lib/zarr";
import type { Workspace } from "@/workspace/store";

interface MovieTaskConfigModalProps {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  /** Pre-select position when opening (e.g. from See context menu). */
  initialPos?: string;
  /** Pre-select crop when opening (e.g. from See context menu). */
  initialCrop?: string;
  onCreate: (params: {
    input_zarr: string;
    pos: number;
    crop: number;
    channel: number;
    time: string;
    output: string;
    fps: number;
    colormap: string;
    spots: string | null;
  }) => void;
}

export function MovieTaskConfigModal({
  open,
  onClose,
  workspace,
  initialPos,
  initialCrop,
  onCreate,
}: MovieTaskConfigModalProps) {
  const rootPath = workspace.rootPath ?? "";
  const inputZarr = rootPath ? `${rootPath.replace(/\/$/, "")}/crops.zarr` : "";
  const defaultOutput = rootPath
    ? `${rootPath.replace(/\/$/, "")}/movie${initialCrop ? `_${initialCrop}` : ""}.mp4`
    : "";

  const [positions, setPositions] = useState<string[]>([]);
  const [cropsByPos, setCropsByPos] = useState<
    Map<string, Array<{ posId: string; cropId: string; shape: number[] }>>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<string>("000");
  const [crop, setCrop] = useState<string>("000");
  const [channel, setChannel] = useState(0);
  const [time, setTime] = useState("all");
  const [output, setOutput] = useState(defaultOutput);
  useEffect(() => {
    if (open) setOutput(defaultOutput);
  }, [open, defaultOutput]);
  const [fps, setFps] = useState(10);
  const [colormap, setColormap] = useState("grayscale");
  const [spots, setSpots] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !rootPath) return;
    let cancelled = false;
    setLoading(true);
    discoverStore(rootPath, undefined, { metadataMode: "fast" })
      .then((idx) => {
        if (cancelled) return;
        setPositions(idx.positions);
        const map = new Map<string, Array<{ posId: string; cropId: string; shape: number[] }>>();
        for (const [posId, infos] of idx.crops) {
          map.set(
            posId,
            infos.map((c) => ({ posId: c.posId, cropId: c.cropId, shape: [...c.shape] })),
          );
        }
        setCropsByPos(map);
        if (idx.positions.length > 0) {
          const posVal =
            initialPos && idx.positions.includes(initialPos) ? initialPos : idx.positions[0];
          setPos(posVal);
          const crops = idx.crops.get(posVal) ?? [];
          const cropVal =
            initialCrop && crops.some((c) => c.cropId === initialCrop)
              ? initialCrop
              : (crops[0]?.cropId ?? "000");
          setCrop(cropVal);
          setChannel(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rootPath, initialPos, initialCrop]);

  const crops = cropsByPos.get(pos) ?? [];
  const selectedCropInfo = crops.find((c) => c.cropId === crop);
  const nChannels = selectedCropInfo?.shape?.[1] ?? 1;

  const handleBrowseOutput = useCallback(async () => {
    const result = await window.mupatternDesktop.tasks.pickMovieOutput();
    if (result) setOutput(result.path);
  }, []);

  const handleBrowseSpots = useCallback(async () => {
    const result = await window.mupatternDesktop.tasks.pickSpotsFile();
    if (result) setSpots(result.path);
  }, []);

  const handleCreate = useCallback(() => {
    onCreate({
      input_zarr: inputZarr,
      pos: Number.parseInt(pos, 10),
      crop: Number.parseInt(crop, 10),
      channel,
      time,
      output,
      fps,
      colormap,
      spots,
    });
    onClose();
  }, [inputZarr, pos, crop, channel, time, output, fps, colormap, spots, onCreate, onClose]);

  const canCreate =
    rootPath &&
    inputZarr &&
    positions.length > 0 &&
    crops.length > 0 &&
    output.trim().length > 0 &&
    channel < nChannels;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New movie task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Discovering crops.zarr…</p>
          ) : positions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No crops.zarr found in workspace. Run a Crop task first.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Position (pos)</label>
                <select
                  className="w-full border rounded px-3 py-2 bg-background text-sm"
                  value={pos}
                  onChange={(e) => {
                    setPos(e.target.value);
                    const c = cropsByPos.get(e.target.value) ?? [];
                    setCrop(c[0]?.cropId ?? "000");
                  }}
                >
                  {positions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Crop</label>
                <select
                  className="w-full border rounded px-3 py-2 bg-background text-sm"
                  value={crop}
                  onChange={(e) => setCrop(e.target.value)}
                >
                  {crops.map((c) => (
                    <option key={c.cropId} value={c.cropId}>
                      {c.cropId}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Channel (0–{nChannels - 1})</label>
                <select
                  className="w-full border rounded px-3 py-2 bg-background text-sm"
                  value={channel}
                  onChange={(e) => setChannel(Number(e.target.value))}
                >
                  {Array.from({ length: nChannels }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Timepoints</label>
                <input
                  type="text"
                  className="w-full border rounded px-3 py-2 bg-background text-sm"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  placeholder="all or 0:10:2"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Output (MP4)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 border rounded px-3 py-2 bg-background text-sm"
                    value={output}
                    onChange={(e) => setOutput(e.target.value)}
                    placeholder="movie.mp4"
                  />
                  <Button variant="outline" size="sm" onClick={handleBrowseOutput}>
                    Browse
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">FPS</label>
                <input
                  type="number"
                  className="w-full border rounded px-3 py-2 bg-background text-sm"
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value) || 10)}
                  min={1}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Colormap</label>
                <select
                  className="w-full border rounded px-3 py-2 bg-background text-sm"
                  value={colormap}
                  onChange={(e) => setColormap(e.target.value)}
                >
                  <option value="grayscale">Grayscale</option>
                  <option value="hot">Hot</option>
                  <option value="viridis">Viridis</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Spots CSV (optional)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 border rounded px-3 py-2 bg-background text-sm"
                    value={spots ?? ""}
                    onChange={(e) => setSpots(e.target.value || null)}
                    placeholder="t,crop,spot,y,x"
                  />
                  <Button variant="outline" size="sm" onClick={handleBrowseSpots}>
                    Browse
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canCreate}>
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

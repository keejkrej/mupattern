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

interface ExpressionTaskConfigModalProps {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  onCreate: (params: {
    workspacePath: string;
    pos: number;
    channel: number;
    output: string;
  }) => void;
}

export function ExpressionTaskConfigModal({
  open,
  onClose,
  workspace,
  onCreate,
}: ExpressionTaskConfigModalProps) {
  const rootPath = workspace.rootPath ?? "";
  const [positions, setPositions] = useState<string[]>([]);
  const [cropsByPos, setCropsByPos] = useState<
    Map<string, Array<{ posId: string; cropId: string; shape: number[] }>>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<string>("000");
  const [channel, setChannel] = useState(0);
  const posIdUnpadded = pos ? String(Number.parseInt(pos, 10)) : "";
  const defaultOutput =
    rootPath && pos ? `${rootPath.replace(/\/$/, "")}/Pos${posIdUnpadded}_expression.csv` : "";
  const [output, setOutput] = useState(defaultOutput);

  useEffect(() => {
    if (open) setOutput(defaultOutput);
  }, [open, defaultOutput]);

  useEffect(() => {
    if (!open || !rootPath) return;
    let cancelled = false;
    setLoading(true);
    discoverStore(rootPath, undefined, { metadataMode: "fast" })
      .then((idx) => {
        if (cancelled) return;
        setPositions(idx.positions);
        const map = new Map<string, Array<{ posId: string; cropId: string; shape: number[] }>>();
        for (const [posId, infos] of idx.crops.entries()) {
          map.set(
            posId,
            infos.map((c) => ({ posId: c.posId, cropId: c.cropId, shape: [...c.shape] })),
          );
        }
        setCropsByPos(map);
        if (idx.positions.length > 0) {
          setPos(idx.positions[0]);
          setChannel(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rootPath]);

  const crops = cropsByPos.get(pos) ?? [];
  const firstCropInfo = crops[0];
  const nChannels = firstCropInfo?.shape?.[1] ?? 1;

  const handleBrowseOutput = useCallback(async () => {
    const result = await window.mupatternDesktop.tasks.pickExpressionOutput(output);
    if (result) setOutput(result.path);
  }, [output]);

  const handleCreate = useCallback(() => {
    onCreate({
      workspacePath: rootPath,
      pos: Number.parseInt(pos, 10),
      channel,
      output,
    });
    onClose();
  }, [rootPath, pos, channel, output, onCreate, onClose]);

  const canCreate =
    rootPath && positions.length > 0 && output.trim().length > 0 && channel < nChannels;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New expression analyze task</DialogTitle>
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
                  onChange={(e) => setPos(e.target.value)}
                >
                  {positions.map((p) => (
                    <option key={p} value={p}>
                      {Number.parseInt(p, 10)}
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
                <label className="text-sm font-medium">Output (CSV)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 border rounded px-3 py-2 bg-background text-sm"
                    value={output}
                    onChange={(e) => setOutput(e.target.value)}
                    placeholder="Pos0_expression.csv"
                  />
                  <Button variant="outline" size="sm" onClick={handleBrowseOutput}>
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

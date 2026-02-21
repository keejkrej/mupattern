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

interface KillTaskConfigModalProps {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  onCreate: (params: {
    workspacePath: string;
    pos: number;
    modelPath: string;
    output: string;
  }) => void;
}

export function KillTaskConfigModal({
  open,
  onClose,
  workspace,
  onCreate,
}: KillTaskConfigModalProps) {
  const rootPath = workspace.rootPath ?? "";
  const defaultOutput = rootPath ? `${rootPath.replace(/\/$/, "")}/predictions.csv` : "";

  const [positions, setPositions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<string>("000");
  const [modelPath, setModelPath] = useState("");
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
        if (idx.positions.length > 0) {
          setPos(idx.positions[0]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rootPath]);

  const handleBrowseModel = useCallback(async () => {
    const result = await window.mupatternDesktop.tasks.pickKillModel();
    if (result) setModelPath(result.path);
  }, []);

  const handleBrowseOutput = useCallback(async () => {
    const result = await window.mupatternDesktop.tasks.pickExpressionOutput();
    if (result) setOutput(result.path);
  }, []);

  const handleCreate = useCallback(() => {
    onCreate({
      workspacePath: rootPath,
      pos: Number.parseInt(pos, 10),
      modelPath,
      output,
    });
    onClose();
  }, [rootPath, pos, modelPath, output, onCreate, onClose]);

  const canCreate =
    rootPath && positions.length > 0 && modelPath.trim().length > 0 && output.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New kill predict task</DialogTitle>
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
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">ONNX model (folder with model.onnx)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 border rounded px-3 py-2 bg-background text-sm"
                    value={modelPath}
                    onChange={(e) => setModelPath(e.target.value)}
                    placeholder="onnx_models/mupattern-resnet18"
                  />
                  <Button variant="outline" size="sm" onClick={handleBrowseModel}>
                    Browse
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Output (CSV)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 border rounded px-3 py-2 bg-background text-sm"
                    value={output}
                    onChange={(e) => setOutput(e.target.value)}
                    placeholder="predictions.csv"
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

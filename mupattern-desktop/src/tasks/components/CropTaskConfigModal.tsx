import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
} from "@mupattern/shared";
import type { Workspace } from "@/workspace/store";

interface CropTaskConfigModalProps {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  onCreate: (pos: number, destination: string, background: boolean) => void;
  positionsWithBbox: number[];
  /** Pre-select this position when opening (e.g. from context menu). */
  initialPos?: number;
}

export function CropTaskConfigModal({
  open,
  onClose,
  workspace,
  onCreate,
  positionsWithBbox,
  initialPos,
}: CropTaskConfigModalProps) {
  const rootPath = workspace.rootPath ?? "";
  const defaultDestination = rootPath ? `${rootPath.replace(/\/$/, "")}/crops.zarr` : "";

  const [pos, setPos] = useState<number>(
    () => initialPos ?? positionsWithBbox[0] ?? workspace.positions[0] ?? 0,
  );
  useEffect(() => {
    if (open && initialPos != null) setPos(initialPos);
  }, [open, initialPos]);
  const [destination, setDestination] = useState(defaultDestination);
  const [background, setBackground] = useState(false);

  const handleBrowse = useCallback(async () => {
    const result = await window.mupatternDesktop.tasks.pickCropsDestination();
    if (result) setDestination(result.path);
  }, []);

  const handleCreate = useCallback(() => {
    onCreate(pos, destination, background);
    onClose();
  }, [pos, destination, background, onCreate, onClose]);

  const canCreate =
    rootPath && pos >= 0 && destination.trim().length > 0 && positionsWithBbox.includes(pos);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New crop task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Position (pos)</label>
            <select
              className="w-full border rounded px-3 py-2 bg-background text-sm"
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
            >
              {workspace.positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                  {positionsWithBbox.includes(p) ? "" : " (no bbox CSV)"}
                </option>
              ))}
            </select>
            {!positionsWithBbox.includes(pos) && (
              <p className="text-xs text-muted-foreground">
                Save bbox CSV in Register first for this position.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Destination (crops.zarr)</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border rounded px-3 py-2 bg-background text-sm"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Path to crops.zarr"
              />
              <Button variant="outline" size="sm" onClick={handleBrowse}>
                Browse
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="crop-background"
              checked={background}
              onChange={(e) => setBackground(e.target.checked)}
            />
            <label htmlFor="crop-background" className="text-sm">
              Compute background
            </label>
          </div>
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

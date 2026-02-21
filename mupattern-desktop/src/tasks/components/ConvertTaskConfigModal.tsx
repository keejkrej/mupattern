import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
} from "@mupattern/shared";

interface ConvertTaskConfigModalProps {
  open: boolean;
  onClose: () => void;
  /** Default output path = current workspace root. User can change. */
  defaultOutputPath?: string | null;
  onCreate: (input: string, output: string, pos: string, time: string) => void;
}

export function ConvertTaskConfigModal({
  open,
  onClose,
  defaultOutputPath,
  onCreate,
}: ConvertTaskConfigModalProps) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [pos, setPos] = useState("all");
  const [time, setTime] = useState("all");

  useEffect(() => {
    if (open) setOutput(defaultOutputPath ?? "");
  }, [open, defaultOutputPath]);

  const handleBrowseInput = useCallback(async () => {
    const result = await window.mupatternDesktop.tasks.pickND2Input();
    if (result) setInput(result.path);
  }, []);

  const handleBrowseOutput = useCallback(async () => {
    const result = await window.mupatternDesktop.tasks.pickConvertOutput();
    if (result) setOutput(result.path);
  }, []);

  const handleCreate = useCallback(() => {
    onCreate(input, output, pos, time);
    onClose();
  }, [input, output, pos, time, onCreate, onClose]);

  const canCreate = input.trim().length > 0 && output.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New convert task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Input (ND2)</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border rounded px-3 py-2 bg-background text-sm"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Path to .nd2 file"
              />
              <Button variant="outline" size="sm" onClick={handleBrowseInput}>
                Browse
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Output folder</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 border rounded px-3 py-2 bg-background text-sm"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
                placeholder="Path for Pos{N}/... TIFFs"
              />
              <Button variant="outline" size="sm" onClick={handleBrowseOutput}>
                Browse
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Positions</label>
            <input
              type="text"
              className="w-full border rounded px-3 py-2 bg-background text-sm"
              value={pos}
              onChange={(e) => setPos(e.target.value)}
              placeholder="all or 0:5, 10"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Timepoints</label>
            <input
              type="text"
              className="w-full border rounded px-3 py-2 bg-background text-sm"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="all or 0:50, 100"
            />
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

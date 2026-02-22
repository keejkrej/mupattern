import { useCallback, useEffect, useState } from "react";
import type { Workspace } from "@/workspace/store";

export interface TissueCsvFile {
  posId: string;
  path: string;
}

export interface TissueRow {
  t: number;
  crop: string;
  cell: number;
  total_fluorescence: number;
  cell_area: number;
  background: number;
}

interface TissueLeftSidebarProps {
  workspace: Workspace;
  selectedPath: string | null;
  onSelect: (path: string, rows: TissueRow[]) => void;
}

export function TissueLeftSidebar({
  workspace,
  selectedPath,
  onSelect,
}: TissueLeftSidebarProps) {
  const rootPath = workspace.rootPath ?? "";
  const [files, setFiles] = useState<TissueCsvFile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!rootPath) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.mupatternDesktop.application
      .listTissueCsv(rootPath)
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  useEffect(() => {
    if (files.length === 0 || selectedPath) return;
    const first = files[0];
    window.mupatternDesktop.application.loadTissueCsv(first.path).then((result) => {
      if (result.ok) onSelect(first.path, result.rows);
    });
  }, [files, selectedPath, onSelect]);

  const handleFileChange = useCallback(
    async (value: string) => {
      if (!value) return;
      const file = files.find((f) => f.path === value);
      if (!file) return;
      const result = await window.mupatternDesktop.application.loadTissueCsv(file.path);
      if (result.ok) {
        onSelect(file.path, result.rows);
      }
    },
    [files, onSelect],
  );

  if (!rootPath) return null;

  return (
    <aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-border p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Tissue CSV
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Choose a position tissue file to view.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Position</label>
        <select
          className="w-full border rounded px-2 py-1 bg-background text-sm"
          value={selectedPath ?? files[0]?.path ?? ""}
          onChange={(e) => void handleFileChange(e.target.value)}
          disabled={loading || files.length === 0}
        >
          {loading || files.length === 0 ? (
            <option value="">{loading ? "Loading…" : "No tissue CSVs"}</option>
          ) : null}
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {Number.parseInt(f.posId, 10)}
            </option>
          ))}
        </select>
      </div>
    </aside>
  );
}

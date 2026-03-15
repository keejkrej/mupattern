import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AppHeader } from "@mupattern/shared";
import { useStore } from "@tanstack/react-store";
import { workspaceStore } from "@/workspace/store";
import { KillTab } from "./kill/KillTab";
import { KillLeftSidebar } from "./kill/KillLeftSidebar";

export default function ApplicationApp() {
  const location = useLocation();
  const locationState = location.state as
    | {
        killRows?: Array<{ t: number; crop: string; label: boolean }>;
      }
    | null;
  const killRowsFromNav = locationState?.killRows ?? null;
  const workspaces = useStore(workspaceStore, (s) => s.workspaces);
  const activeId = useStore(workspaceStore, (s) => s.activeId);
  const activeWorkspace = activeId ? (workspaces.find((w) => w.id === activeId) ?? null) : null;
  const [killRows, setKillRows] = useState<Array<{ t: number; crop: string; label: boolean }> | null>(
    killRowsFromNav ?? null,
  );
  const [selectedKillPath, setSelectedKillPath] = useState<string | null>(null);

  useEffect(() => {
    if (killRowsFromNav && killRowsFromNav.length > 0) {
      setKillRows(killRowsFromNav);
    }
  }, [killRowsFromNav]);

  const handleKillSelect = useCallback(
    (path: string, rows: Array<{ t: number; crop: string; label: boolean }>) => {
      setSelectedKillPath(path);
      setKillRows(rows);
    },
    [],
  );

  return (
    <div className="flex flex-col h-screen">
      <AppHeader title="Application" backTo="/workspace" />

      {!activeWorkspace ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            Open a workspace from the workspace dashboard first.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          <KillLeftSidebar
            workspace={activeWorkspace}
            selectedPath={selectedKillPath}
            onSelect={handleKillSelect}
          />
          <div className="flex-1 overflow-auto p-6">
            <KillTab workspace={activeWorkspace} initialRows={killRows} />
          </div>
        </div>
      )}
    </div>
  );
}

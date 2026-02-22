import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import { AppHeader } from "@mupattern/shared";
import { useStore } from "@tanstack/react-store";
import { workspaceStore } from "@/workspace/store";
import { ExpressionTab } from "./expression/ExpressionTab";
import { ExpressionLeftSidebar } from "./expression/ExpressionLeftSidebar";
import { KillTab } from "./kill/KillTab";
import { KillLeftSidebar } from "./kill/KillLeftSidebar";

const APPLICATION_TAB_KEY = "mupattern-application-tab";

function getStoredTab(): "expression" | "kill" {
  if (typeof window === "undefined") return "expression";
  const stored = sessionStorage.getItem(APPLICATION_TAB_KEY);
  return stored === "kill" ? "kill" : "expression";
}

export default function ApplicationApp() {
  const location = useLocation();
  const locationState = location.state as {
    expressionRows?: Array<{
      t: number;
      crop: string;
      intensity: number;
      area: number;
      background: number;
    }>;
    killRows?: Array<{ t: number; crop: string; label: boolean }>;
  } | null;
  const expressionRowsFromNav = locationState?.expressionRows ?? null;
  const killRowsFromNav = locationState?.killRows ?? null;
  const workspaces = useStore(workspaceStore, (s) => s.workspaces);
  const activeId = useStore(workspaceStore, (s) => s.activeId);
  const activeWorkspace = activeId ? (workspaces.find((w) => w.id === activeId) ?? null) : null;

  const [expressionRows, setExpressionRows] = useState<Array<{
    t: number;
    crop: string;
    intensity: number;
    area: number;
    background: number;
  }> | null>(expressionRowsFromNav);
  const [selectedExpressionPath, setSelectedExpressionPath] = useState<string | null>(null);

  const [killRows, setKillRows] = useState<Array<{ t: number; crop: string; label: boolean }> | null>(
    killRowsFromNav ?? null,
  );
  const [selectedKillPath, setSelectedKillPath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"expression" | "kill">(getStoredTab);

  useEffect(() => {
    sessionStorage.setItem(APPLICATION_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (expressionRowsFromNav) {
      setExpressionRows(expressionRowsFromNav);
    }
  }, [expressionRowsFromNav]);

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

  const handleExpressionSelect = useCallback(
    (
      path: string,
      rows: Array<{ t: number; crop: string; intensity: number; area: number; background: number }>,
    ) => {
      setSelectedExpressionPath(path);
      setExpressionRows(rows);
    },
    [],
  );

  return (
    <div className="flex flex-col h-screen">
      <AppHeader title="Application" subtitle="Expression and kill analysis" backTo="/workspace" />

      {!activeWorkspace ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            Open a workspace from the workspace dashboard first.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          <Tabs.Root
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "expression" | "kill")}
            className="flex flex-1 min-h-0 flex-col"
          >
            <div className="flex border-b border-border px-4">
              <Tabs.List className="flex gap-2">
                <Tabs.Trigger
                  value="expression"
                  className="px-4 py-2 rounded-t border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-primary/5 text-sm font-medium transition-colors"
                >
                  Expression
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="kill"
                  className="px-4 py-2 rounded-t border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-primary/5 text-sm font-medium transition-colors"
                >
                  Kill
                </Tabs.Trigger>
              </Tabs.List>
            </div>
            <div className="flex flex-1 min-h-0">
              <Tabs.Content
                value="expression"
                className="flex flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
              >
                <ExpressionLeftSidebar
                  workspace={activeWorkspace}
                  selectedPath={selectedExpressionPath}
                  onSelect={handleExpressionSelect}
                />
                <div className="flex-1 overflow-auto p-6">
                  <ExpressionTab workspace={activeWorkspace} rows={expressionRows} />
                </div>
              </Tabs.Content>
              <Tabs.Content
                value="kill"
                className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden flex"
              >
                <KillLeftSidebar
                  workspace={activeWorkspace}
                  selectedPath={selectedKillPath}
                  onSelect={handleKillSelect}
                />
                <div className="flex-1 overflow-auto p-6">
                  <KillTab workspace={activeWorkspace} initialRows={killRows} />
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </div>
      )}
    </div>
  );
}

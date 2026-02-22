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
import { TissueTab } from "./tissue/TissueTab";
import { TissueLeftSidebar } from "./tissue/TissueLeftSidebar";

const APPLICATION_TAB_KEY = "mupattern-application-tab";

type ApplicationTab = "expression" | "kill" | "tissue";

function getStoredTab(): ApplicationTab {
  if (typeof window === "undefined") return "expression";
  const stored = sessionStorage.getItem(APPLICATION_TAB_KEY);
  if (stored === "kill" || stored === "tissue") return stored;
  return "expression";
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
    tissueRows?: Array<{
      t: number;
      crop: string;
      cell: number;
      total_fluorescence: number;
      cell_area: number;
      background: number;
    }>;
  } | null;
  const expressionRowsFromNav = locationState?.expressionRows ?? null;
  const killRowsFromNav = locationState?.killRows ?? null;
  const tissueRowsFromNav = locationState?.tissueRows ?? null;
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
  const [tissueRows, setTissueRows] = useState<
    Array<{
      t: number;
      crop: string;
      cell: number;
      total_fluorescence: number;
      cell_area: number;
      background: number;
    }> | null
  >(null);
  const [selectedTissuePath, setSelectedTissuePath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ApplicationTab>(getStoredTab);

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

  useEffect(() => {
    if (tissueRowsFromNav && tissueRowsFromNav.length > 0) {
      setTissueRows(tissueRowsFromNav);
      setActiveTab("tissue");
    }
  }, [tissueRowsFromNav]);

  const handleKillSelect = useCallback(
    (path: string, rows: Array<{ t: number; crop: string; label: boolean }>) => {
      setSelectedKillPath(path);
      setKillRows(rows);
    },
    [],
  );

  const handleTissueSelect = useCallback(
    (
      path: string,
      rows: Array<{
        t: number;
        crop: string;
        cell: number;
        total_fluorescence: number;
        cell_area: number;
        background: number;
      }>,
    ) => {
      setSelectedTissuePath(path);
      setTissueRows(rows);
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
      <AppHeader title="Application" backTo="/workspace" />

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
            onValueChange={(v) => setActiveTab(v as ApplicationTab)}
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
                <Tabs.Trigger
                  value="tissue"
                  className="px-4 py-2 rounded-t border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-primary/5 text-sm font-medium transition-colors"
                >
                  Tissue
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
              <Tabs.Content
                value="tissue"
                className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden flex"
              >
                <TissueLeftSidebar
                  workspace={activeWorkspace}
                  selectedPath={selectedTissuePath}
                  onSelect={handleTissueSelect}
                />
                <div className="flex-1 overflow-auto p-6">
                  <TissueTab workspace={activeWorkspace} rows={tissueRows} />
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </div>
      )}
    </div>
  );
}

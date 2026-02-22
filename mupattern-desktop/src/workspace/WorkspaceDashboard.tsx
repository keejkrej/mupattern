import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useStore } from "@tanstack/react-store";
import { Button, HexBackground, ThemeToggle, useTheme } from "@mupattern/shared";
import { ArrowLeft, Crop, Plus } from "lucide-react";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { toast } from "sonner";
import {
  workspaceStore,
  addWorkspace,
  removeWorkspace,
  setActiveWorkspace,
  updateWorkspaceScan,
  setCurrentIndex,
  addPositionTag,
  removePositionTag,
  togglePositionTagFilter,
  clearPositionTagFilters,
  setPositionTagsFromDict,
  getWorkspaceVisiblePositionIndices,
  type Workspace,
} from "@/workspace/store";
import { parseSliceStringOverValues } from "@/lib/slices";
import { posTagsToDict } from "@/lib/tags-yaml";
import { CropTaskConfigModal } from "@/tasks/components/CropTaskConfigModal";
import { createCropTask } from "@/tasks/lib/create-crop-task";

export default function WorkspaceDashboard() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const workspaces = useStore(workspaceStore, (s) => s.workspaces);
  const activeId = useStore(workspaceStore, (s) => s.activeId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagLabel, setTagLabel] = useState("");
  const [tagSlice, setTagSlice] = useState("0");
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropModalInitialPos, setCropModalInitialPos] = useState<number | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; pos: number } | null>(
    null,
  );
  const [positionsWithBbox, setPositionsWithBbox] = useState<number[]>([]);
  const [pathExistsByWorkspaceId, setPathExistsByWorkspaceId] = useState<
    Record<string, boolean>
  >({});

  const handleAddWorkspace = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await window.mupatternDesktop.workspace.pickDirectory();
      if (!result) {
        setLoading(false);
        return;
      }
      const { path, name, positions, channels, times, zSlices } = result;
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name,
        rootPath: path,
        positions,
        posTags: [],
        positionFilterLabels: [],
        channels: channels.length > 0 ? channels : [0],
        times: times.length > 0 ? times : [0],
        zSlices: zSlices.length > 0 ? zSlices : [0],
        selectedChannel: channels[0] ?? 0,
        selectedTime: times[0] ?? 0,
        selectedZ: zSlices[0] ?? 0,
        currentIndex: 0,
      };
      addWorkspace(workspace);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") {
        setError("Failed to open folder.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = useCallback(async (ws: Workspace) => {
    setError(null);
    if (!ws.rootPath) {
      setError("Workspace path is unavailable. Remove and re-add this workspace.");
      return;
    }
    const scan = await window.mupatternDesktop.workspace.rescanDirectory(ws.rootPath);
    if (scan) updateWorkspaceScan(ws.id, scan);
    setActiveWorkspace(ws.id);
  }, []);

  const handlePositionSelect = useCallback((ws: Workspace, index: number) => {
    setError(null);
    setCurrentIndex(ws.id, index);
  }, []);

  const handleAddTag = useCallback(
    (ws: Workspace) => {
      const label = tagLabel.trim();
      if (!label) {
        setError("Tag label is required.");
        return;
      }

      let indices: number[] = [];
      try {
        indices = parseSliceStringOverValues(tagSlice, ws.positions);
      } catch (e) {
        setError((e as Error).message);
        return;
      }

      // Compress parsed indices into contiguous ranges to match store tag model.
      let runStart = indices[0];
      let runEnd = indices[0];
      for (let i = 1; i < indices.length; i += 1) {
        const idx = indices[i];
        if (idx === runEnd + 1) {
          runEnd = idx;
          continue;
        }
        addPositionTag(ws.id, label, runStart, runEnd);
        runStart = idx;
        runEnd = idx;
      }
      addPositionTag(ws.id, label, runStart, runEnd);

      setError(null);
      setTagLabel("");
    },
    [tagLabel, tagSlice],
  );

  const handleSaveTag = useCallback(async (ws: Workspace) => {
    const dict = posTagsToDict(ws.positions, ws.posTags);
    const yaml = yamlStringify(dict);
    try {
      if ("showSaveFilePicker" in window) {
        const handle = await (
          window as Window & {
            showSaveFilePicker: (opts: {
              suggestedName?: string;
              types?: Array<{ description?: string; accept: Record<string, string[]> }>;
            }) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker({
          suggestedName: "tags.yaml",
          types: [{ description: "YAML", accept: { "text/yaml": [".yaml", ".yml"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(yaml);
        await writable.close();
        toast.success("Tags saved");
        return;
      }
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
    }
    const blob = new Blob([yaml], { type: "text/yaml" });
    const link = document.createElement("a");
    link.download = "tags.yaml";
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Tags saved");
  }, []);

  const handleLoadTag = useCallback(async (ws: Workspace) => {
    const text = await window.mupatternDesktop.workspace.pickTagsFile();
    if (text == null) return;
    let dict: Record<string, unknown>;
    try {
      const parsed = yamlParse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Invalid tags YAML: expected object");
        return;
      }
      dict = parsed as Record<string, unknown>;
    } catch (e) {
      setError(`Failed to parse YAML: ${(e as Error).message}`);
      return;
    }
    const tagDict: Record<string, string> = {};
    for (const [k, v] of Object.entries(dict)) {
      if (v == null || v === "") continue;
      const sliceStr = typeof v === "string" ? v : String(v);
      tagDict[k.trim()] = sliceStr.trim();
    }
    setPositionTagsFromDict(ws.id, tagDict);
    setError(null);
    toast.success("Tags loaded");
  }, []);

  const handleOpenRegister = useCallback(() => {
    setError(null);
    navigate("/register");
  }, [navigate]);

  const activeWorkspace = activeId ? workspaces.find((w) => w.id === activeId) : null;
  const visibleIndices = activeWorkspace ? getWorkspaceVisiblePositionIndices(activeWorkspace) : [];

  useEffect(() => {
    if (!activeWorkspace?.rootPath) {
      setPositionsWithBbox([]);
      return;
    }
    const check = async () => {
      const results = await Promise.all(
        activeWorkspace.positions.map((pos) =>
          window.mupatternDesktop.tasks.hasBboxCsv({
            workspacePath: activeWorkspace.rootPath!,
            pos,
          }),
        ),
      );
      setPositionsWithBbox(activeWorkspace.positions.filter((_, i) => results[i]));
    };
    void check();
  }, [activeWorkspace]);

  useEffect(() => {
    if (workspaces.length === 0) {
      setPathExistsByWorkspaceId({});
      return;
    }
    let cancelled = false;
    const check = async () => {
      const results = await Promise.all(
        workspaces.map((ws) =>
          ws.rootPath
            ? window.mupatternDesktop.workspace.pathExists(ws.rootPath)
            : Promise.resolve(false),
        ),
      );
      if (cancelled) return;
      const next: Record<string, boolean> = {};
      workspaces.forEach((ws, i) => {
        next[ws.id] = results[i] ?? false;
      });
      setPathExistsByWorkspaceId(next);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [workspaces]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-context-menu]")) return;
      setContextMenu(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const handleCreateCrop = useCallback(
    async (pos: number, destination: string, background: boolean) => {
      if (!activeWorkspace?.rootPath) return;
      setCropModalOpen(false);
      setContextMenu(null);
      await createCropTask({
        input_dir: activeWorkspace.rootPath,
        pos,
        bbox: `${activeWorkspace.rootPath}/Pos${pos}_bbox.csv`,
        output: destination,
        background,
      });
    },
    [activeWorkspace],
  );
  const filterLabels = activeWorkspace
    ? [...new Set(activeWorkspace.posTags.map((tag) => tag.label))].sort((a, b) =>
        a.localeCompare(b),
      )
    : [];

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center gap-8 p-6">
      <HexBackground theme={theme} />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-2xl space-y-4 backdrop-blur-sm bg-background/80 rounded-lg border p-6">
        <div className="text-center">
          <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Bitcount", monospace' }}>
            MuPattern
          </h1>
          <div className="mt-3 border-t border-border/70" />
        </div>

        {activeWorkspace ? (
          <>
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon-sm" onClick={() => setActiveWorkspace(null)}>
                <ArrowLeft className="size-4" />
              </Button>
              <h2 className="text-lg font-medium">{activeWorkspace.name}</h2>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              <div className="flex flex-wrap items-end gap-2 rounded-md border p-2 mb-2 bg-background/60">
                <div className="min-w-40 flex-1">
                  <label className="text-xs text-muted-foreground">Tag</label>
                  <input
                    type="text"
                    value={tagLabel}
                    onChange={(e) => setTagLabel(e.target.value)}
                    placeholder="sample-a"
                    className="w-full h-8 px-2 rounded border bg-background text-sm"
                  />
                </div>
                <div className="min-w-48 flex-1">
                  <label className="text-xs text-muted-foreground">Position slice</label>
                  <input
                    type="text"
                    value={tagSlice}
                    onChange={(e) => setTagSlice(e.target.value)}
                    placeholder="all | 140 | 140:160:5"
                    className="w-full h-8 px-2 rounded border bg-background text-sm"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => handleAddTag(activeWorkspace)}>
                  Add tag
                </Button>
                <div className="min-w-48 flex-1">
                  <label className="text-xs text-muted-foreground">Filter</label>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className={`px-2 py-1 rounded border text-xs ${
                        activeWorkspace.positionFilterLabels.length === 0
                          ? "bg-primary/10 border-primary"
                          : "bg-background"
                      }`}
                      onClick={() => clearPositionTagFilters(activeWorkspace.id)}
                    >
                      All
                    </button>
                    {filterLabels.map((label) => (
                      <button
                        key={label}
                        type="button"
                        className={`px-2 py-1 rounded border text-xs ${
                          activeWorkspace.positionFilterLabels.includes(label)
                            ? "bg-primary/10 border-primary"
                            : "bg-background"
                        }`}
                        onClick={() => togglePositionTagFilter(activeWorkspace.id, label)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {visibleIndices.length === 0 ? (
                  <div className="col-span-full text-sm text-muted-foreground text-center py-8 border rounded border-dashed">
                    <p>
                      No positions yet. Run a Convert task to create TIFFs from ND2 in this folder,
                      then go back and click Open.
                    </p>
                  </div>
                ) : (
                  visibleIndices.map((i) => {
                    const pos = activeWorkspace.positions[i];
                    const tags = activeWorkspace.posTags.filter(
                      (tag) => i >= tag.startIndex && i <= tag.endIndex,
                    );
                    return (
                      <div
                        key={pos}
                        onClick={() => handlePositionSelect(activeWorkspace, i)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, pos });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handlePositionSelect(activeWorkspace, i);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`text-left rounded border text-sm transition-colors ${
                          i === activeWorkspace.currentIndex
                            ? "border-primary bg-primary/10"
                            : "hover:bg-accent"
                        }`}
                      >
                        <div className="px-3 py-2">
                          <span className="font-medium">{pos}</span>
                        </div>
                        <div className="border-t px-3 py-2 flex flex-wrap gap-1 min-h-9">
                          {tags.length === 0 ? (
                            <span className="text-xs text-muted-foreground">No tags</span>
                          ) : (
                            tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-background"
                              >
                                {tag.label}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removePositionTag(activeWorkspace.id, tag.id);
                                  }}
                                  className="text-muted-foreground hover:text-foreground"
                                  aria-label={`Remove ${tag.label} tag`}
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {contextMenu &&
              createPortal(
                <div
                  data-context-menu
                  className="fixed z-[9999] border rounded bg-background shadow-lg py-1 min-w-[160px]"
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 hover:bg-accent text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!positionsWithBbox.includes(contextMenu.pos)}
                    onClick={() => {
                      setCropModalInitialPos(contextMenu.pos);
                      setContextMenu(null);
                      setCropModalOpen(true);
                    }}
                  >
                    <Crop className="size-4" />
                    Crop
                  </button>
                </div>,
                document.body,
              )}

            <div className="flex justify-between items-center gap-4">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleLoadTag(activeWorkspace)}
                >
                  Load tag
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleSaveTag(activeWorkspace)}>
                  Save tag
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenRegister}
                  disabled={visibleIndices.length === 0}
                >
                  Register
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/see")}>
                  See
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/tasks")}>
                  Tasks
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/application")}>
                  Application
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Workspaces</h2>
              <Button size="sm" variant="outline" onClick={handleAddWorkspace} disabled={loading}>
                <Plus className="size-4" />
                {loading ? "Scanning..." : "Add workspace"}
              </Button>
            </div>

            {workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Add a workspace to get started.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {workspaces.map((ws) => {
                  const pathExists = pathExistsByWorkspaceId[ws.id] ?? true;
                  return (
                    <div key={ws.id} className="border rounded-lg p-4 flex flex-col gap-3">
                      <p className="font-medium">{ws.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {ws.positions.length} position{ws.positions.length !== 1 ? "s" : ""}
                      </p>
                      {!pathExists && (
                        <p className="text-sm text-destructive">
                          Path no longer exists. Remove this workspace.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpen(ws)}
                          disabled={!pathExists}
                        >
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeWorkspace(ws.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>

      {activeWorkspace && (
        <CropTaskConfigModal
          key={activeWorkspace.id}
          open={cropModalOpen}
          onClose={() => {
            setCropModalOpen(false);
            setCropModalInitialPos(undefined);
          }}
          workspace={activeWorkspace}
          onCreate={handleCreateCrop}
          positionsWithBbox={positionsWithBbox}
          initialPos={cropModalInitialPos}
        />
      )}
    </div>
  );
}

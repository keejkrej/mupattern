import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@tanstack/react-store";
import { AppHeader, Button } from "@mupattern/shared";
import { Plus, Trash2 } from "lucide-react";
import { workspaceStore } from "@/workspace/store";
import { CropTaskConfigModal } from "@/tasks/components/CropTaskConfigModal";
import { ConvertTaskConfigModal } from "@/tasks/components/ConvertTaskConfigModal";
import { MovieTaskConfigModal } from "@/tasks/components/MovieTaskConfigModal";
import { ExpressionTaskConfigModal } from "@/tasks/components/ExpressionTaskConfigModal";
import { KillTaskConfigModal } from "@/tasks/components/KillTaskConfigModal";
import { TissueTaskConfigModal } from "@/tasks/components/TissueTaskConfigModal";

interface TaskRecord {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  request: Record<string, unknown>;
  result:
    | {
        output?: string;
        rows?:
          | Array<{ t: number; crop: string; intensity: number; area: number; background: number }>
          | Array<{ t: number; crop: string; label: boolean }>
          | Array<{
              t: number;
              crop: string;
              cell: number;
              total_fluorescence: number;
              cell_area: number;
              background: number;
            }>;
      }
    | Record<string, unknown>
    | null;
  error: string | null;
  logs: string[];
  progress_events: Array<{ progress: number; message: string; timestamp: string }>;
}

export default function TasksDashboardPage() {
  const navigate = useNavigate();
  const workspaces = useStore(workspaceStore, (s) => s.workspaces);
  const activeId = useStore(workspaceStore, (s) => s.activeId);

  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [movieModalOpen, setMovieModalOpen] = useState(false);
  const [expressionModalOpen, setExpressionModalOpen] = useState(false);
  const [killModalOpen, setKillModalOpen] = useState(false);
  const [tissueModalOpen, setTissueModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progressUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    window.mupatternDesktop.tasks.listTasks().then((list) => {
      setTasks(list as unknown as TaskRecord[]);
    });
  }, []);

  const hasRunningTasks = tasks.some((t) => t.status === "running");
  const hasCompletedTasks = tasks.some(
    (t) => t.status !== "running" && t.status !== "queued",
  );
  useEffect(() => {
    if (!hasRunningTasks) return;
    const id = setInterval(() => {
      window.mupatternDesktop.tasks.listTasks().then((list) => {
        setTasks(list as unknown as TaskRecord[]);
      });
    }, 2000);
    return () => clearInterval(id);
  }, [hasRunningTasks]);

  const activeWorkspace = useMemo(
    () => (activeId ? (workspaces.find((w) => w.id === activeId) ?? null) : null),
    [activeId, workspaces],
  );

  const [positionsWithBboxResolved, setPositionsWithBboxResolved] = useState<number[]>([]);

  useEffect(() => {
    if (!activeWorkspace?.rootPath) {
      setPositionsWithBboxResolved([]);
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
      setPositionsWithBboxResolved(activeWorkspace.positions.filter((_, i) => results[i]));
    };
    void check();
  }, [activeWorkspace]);

  const handleCreateCrop = useCallback(
    async (pos: number, destination: string, background: boolean) => {
      if (!activeWorkspace?.rootPath) return;
      setError(null);
      const taskId = crypto.randomUUID();
      const task: TaskRecord = {
        id: taskId,
        kind: "file.crop",
        status: "running",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: null,
        request: { pos, output: destination, background },
        result: null,
        error: null,
        logs: [],
        progress_events: [],
      };
      await window.mupatternDesktop.tasks.insertTask(task as unknown);
      setTasks((prev) => [task, ...prev]);
      setSelectedTaskId(taskId);
      setCropModalOpen(false);
      setAddMenuOpen(false);

      progressUnsubscribeRef.current = window.mupatternDesktop.tasks.onCropProgress((ev) => {
        if (ev.taskId !== taskId) return;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              progress_events: [
                ...t.progress_events,
                {
                  progress: ev.progress,
                  message: ev.message,
                  timestamp: new Date().toISOString(),
                },
              ],
            };
          }),
        );
      });

      try {
        const result = await window.mupatternDesktop.tasks.runCrop({
          taskId,
          input_dir: activeWorkspace.rootPath,
          pos,
          bbox: `${activeWorkspace.rootPath}/Pos${pos}_bbox.csv`,
          output: destination,
          background,
        });
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: result.ok ? "succeeded" : "failed",
              finished_at: new Date().toISOString(),
              error: result.ok ? null : result.error,
            };
          }),
        );
      } catch (e) {
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: "failed",
              finished_at: new Date().toISOString(),
              error: e instanceof Error ? e.message : String(e),
            };
          }),
        );
      }
    },
    [activeWorkspace],
  );

  const handleCreateExpressionAnalyze = useCallback(
    async (params: { workspacePath: string; pos: number; channel: number; output: string }) => {
      if (!activeWorkspace?.rootPath) return;
      setError(null);
      const taskId = crypto.randomUUID();
      const task: TaskRecord = {
        id: taskId,
        kind: "expression.analyze",
        status: "running",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: null,
        request: params,
        result: null,
        error: null,
        logs: [],
        progress_events: [],
      };
      await window.mupatternDesktop.tasks.insertTask(task as unknown);
      setTasks((prev) => [task, ...prev]);
      setSelectedTaskId(taskId);
      setExpressionModalOpen(false);
      setAddMenuOpen(false);

      progressUnsubscribeRef.current = window.mupatternDesktop.tasks.onExpressionAnalyzeProgress(
        (ev) => {
          if (ev.taskId !== taskId) return;
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== taskId) return t;
              return {
                ...t,
                progress_events: [
                  ...t.progress_events,
                  {
                    progress: ev.progress,
                    message: ev.message,
                    timestamp: new Date().toISOString(),
                  },
                ],
              };
            }),
          );
        },
      );

      try {
        const result = await window.mupatternDesktop.tasks.runExpressionAnalyze({
          taskId,
          ...params,
        });
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: result.ok ? "succeeded" : "failed",
              finished_at: new Date().toISOString(),
              error: result.ok ? null : result.error,
              result: result.ok ? { output: result.output, rows: result.rows } : null,
            };
          }),
        );
      } catch (e) {
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: "failed",
              finished_at: new Date().toISOString(),
              error: e instanceof Error ? e.message : String(e),
            };
          }),
        );
      }
    },
    [activeWorkspace],
  );

  const handleCreateTissueAnalyze = useCallback(
    async (params: {
      workspacePath: string;
      pos: number;
      channelPhase: number;
      channelFluorescence: number;
      method: string;
      model: string;
      output: string;
    }) => {
      if (!activeWorkspace?.rootPath) return;
      setError(null);
      const taskId = crypto.randomUUID();
      const task: TaskRecord = {
        id: taskId,
        kind: "tissue.analyze",
        status: "running",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: null,
        request: params,
        result: null,
        error: null,
        logs: [],
        progress_events: [],
      };
      await window.mupatternDesktop.tasks.insertTask(task as unknown);
      setTasks((prev) => [task, ...prev]);
      setSelectedTaskId(taskId);
      setTissueModalOpen(false);
      setAddMenuOpen(false);

      progressUnsubscribeRef.current = window.mupatternDesktop.tasks.onTissueAnalyzeProgress(
        (ev) => {
          if (ev.taskId !== taskId) return;
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== taskId) return t;
              return {
                ...t,
                progress_events: [
                  ...t.progress_events,
                  {
                    progress: ev.progress,
                    message: ev.message,
                    timestamp: new Date().toISOString(),
                  },
                ],
              };
            }),
          );
        },
      );

      try {
        const result = await window.mupatternDesktop.tasks.runTissueAnalyze({
          taskId,
          ...params,
        });
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: result.ok ? "succeeded" : "failed",
              finished_at: new Date().toISOString(),
              error: result.ok ? null : result.error,
              result: result.ok ? { output: result.output, rows: result.rows } : null,
            };
          }),
        );
      } catch (e) {
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: "failed",
              finished_at: new Date().toISOString(),
              error: e instanceof Error ? e.message : String(e),
            };
          }),
        );
      }
    },
    [activeWorkspace],
  );

  const handleCreateKillPredict = useCallback(
    async (params: { workspacePath: string; pos: number; modelPath: string; output: string }) => {
      if (!activeWorkspace?.rootPath) return;
      setError(null);
      const taskId = crypto.randomUUID();
      const task: TaskRecord = {
        id: taskId,
        kind: "kill.predict",
        status: "running",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: null,
        request: params,
        result: null,
        error: null,
        logs: [],
        progress_events: [],
      };
      await window.mupatternDesktop.tasks.insertTask(task as unknown);
      setTasks((prev) => [task, ...prev]);
      setSelectedTaskId(taskId);
      setKillModalOpen(false);
      setAddMenuOpen(false);

      progressUnsubscribeRef.current = window.mupatternDesktop.tasks.onKillPredictProgress((ev) => {
        if (ev.taskId !== taskId) return;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              progress_events: [
                ...t.progress_events,
                {
                  progress: ev.progress,
                  message: ev.message,
                  timestamp: new Date().toISOString(),
                },
              ],
            };
          }),
        );
      });

      try {
        const result = await window.mupatternDesktop.tasks.runKillPredict({
          taskId,
          ...params,
        });
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: result.ok ? "succeeded" : "failed",
              finished_at: new Date().toISOString(),
              error: result.ok ? null : result.error,
              result: result.ok ? { output: result.output, rows: result.rows } : null,
            };
          }),
        );
      } catch (e) {
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: "failed",
              finished_at: new Date().toISOString(),
              error: e instanceof Error ? e.message : String(e),
            };
          }),
        );
      }
    },
    [activeWorkspace],
  );

  const handleCreateMovie = useCallback(
    async (params: {
      input_zarr: string;
      pos: number;
      crop: number;
      channel: number;
      time: string;
      output: string;
      fps: number;
      colormap: string;
      spots: string | null;
    }) => {
      if (!activeWorkspace?.rootPath) return;
      setError(null);
      const taskId = crypto.randomUUID();
      const task: TaskRecord = {
        id: taskId,
        kind: "file.movie",
        status: "running",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: null,
        request: params,
        result: null,
        error: null,
        logs: [],
        progress_events: [],
      };
      await window.mupatternDesktop.tasks.insertTask(task as unknown);
      setTasks((prev) => [task, ...prev]);
      setSelectedTaskId(taskId);
      setMovieModalOpen(false);
      setAddMenuOpen(false);

      progressUnsubscribeRef.current = window.mupatternDesktop.tasks.onMovieProgress((ev) => {
        if (ev.taskId !== taskId) return;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              progress_events: [
                ...t.progress_events,
                {
                  progress: ev.progress,
                  message: ev.message,
                  timestamp: new Date().toISOString(),
                },
              ],
            };
          }),
        );
      });

      try {
        const result = await window.mupatternDesktop.tasks.runMovie({
          taskId,
          ...params,
        });
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: result.ok ? "succeeded" : "failed",
              finished_at: new Date().toISOString(),
              error: result.ok ? null : result.error,
            };
          }),
        );
      } catch (e) {
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: "failed",
              finished_at: new Date().toISOString(),
              error: e instanceof Error ? e.message : String(e),
            };
          }),
        );
      }
    },
    [activeWorkspace],
  );

  const handleCreateConvert = useCallback(
    async (input: string, output: string, pos: string, time: string) => {
      setError(null);
      const taskId = crypto.randomUUID();
      const task: TaskRecord = {
        id: taskId,
        kind: "file.convert",
        status: "running",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: null,
        request: { input, output, pos, time },
        result: null,
        error: null,
        logs: [],
        progress_events: [],
      };
      await window.mupatternDesktop.tasks.insertTask(task as unknown);
      setTasks((prev) => [task, ...prev]);
      setSelectedTaskId(taskId);
      setConvertModalOpen(false);
      setAddMenuOpen(false);

      progressUnsubscribeRef.current = window.mupatternDesktop.tasks.onConvertProgress((ev) => {
        if (ev.taskId !== taskId) return;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              progress_events: [
                ...t.progress_events,
                {
                  progress: ev.progress,
                  message: ev.message,
                  timestamp: new Date().toISOString(),
                },
              ],
            };
          }),
        );
      });

      try {
        const result = await window.mupatternDesktop.tasks.runConvert({
          taskId,
          input,
          output,
          pos,
          time,
        });
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: result.ok ? "succeeded" : "failed",
              finished_at: new Date().toISOString(),
              error: result.ok ? null : result.error,
            };
          }),
        );
      } catch (e) {
        progressUnsubscribeRef.current?.();
        progressUnsubscribeRef.current = null;
        setError(e instanceof Error ? e.message : String(e));
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              status: "failed",
              finished_at: new Date().toISOString(),
              error: e instanceof Error ? e.message : String(e),
            };
          }),
        );
      }
    },
    [],
  );

  return (
    <div className="flex flex-col h-screen">
      <AppHeader
        title="Tasks"
        subtitle="Run convert, crop, expression, kill, tissue, and movie tasks"
        backTo="/workspace"
      />

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="p-6 space-y-4">
          {!activeWorkspace ? (
            <p className="text-sm text-muted-foreground">
              Open a workspace for Crop, Expression, Kill, and Movie. Convert works with or without
              a workspace.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Workspace: {activeWorkspace.name} ({activeWorkspace.rootPath})
            </p>
          )}

          <div className="flex items-center gap-2">
            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setAddMenuOpen((o) => !o)}
                className="border bg-white text-black hover:bg-gray-100 dark:bg-black dark:text-white dark:hover:bg-gray-900 dark:border-input"
              >
                <Plus className="size-4 mr-2" />
                Add task
              </Button>
            {addMenuOpen && (
              <div className="absolute left-0 top-full mt-1 border rounded bg-background shadow-lg py-1 z-20 min-w-[120px]">
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-accent text-sm"
                  onClick={() => {
                    setConvertModalOpen(true);
                    setAddMenuOpen(false);
                  }}
                >
                  Convert
                </button>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-accent text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!activeWorkspace}
                  onClick={() => {
                    if (!activeWorkspace) return;
                    setCropModalOpen(true);
                    setAddMenuOpen(false);
                  }}
                >
                  Crop
                </button>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-accent text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!activeWorkspace}
                  onClick={() => {
                    if (!activeWorkspace) return;
                    setMovieModalOpen(true);
                    setAddMenuOpen(false);
                  }}
                >
                  Movie
                </button>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-accent text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!activeWorkspace}
                  onClick={() => {
                    if (!activeWorkspace) return;
                    setExpressionModalOpen(true);
                    setAddMenuOpen(false);
                  }}
                >
                  Expression
                </button>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-accent text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!activeWorkspace}
                  onClick={() => {
                    if (!activeWorkspace) return;
                    setKillModalOpen(true);
                    setAddMenuOpen(false);
                  }}
                >
                  Kill
                </button>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 hover:bg-accent text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!activeWorkspace}
                  onClick={() => {
                    if (!activeWorkspace) return;
                    setTissueModalOpen(true);
                    setAddMenuOpen(false);
                  }}
                >
                  Tissue
                </button>
              </div>
            )}
            </div>
            <Button
              variant="outline"
              disabled={!hasCompletedTasks}
              onClick={async () => {
                await window.mupatternDesktop.tasks.deleteCompletedTasks();
                const list = await window.mupatternDesktop.tasks.listTasks();
                setTasks(list as unknown as TaskRecord[]);
              }}
              className="border bg-white text-black hover:bg-gray-100 dark:bg-black dark:text-white dark:hover:bg-gray-900 dark:border-input disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="size-4 mr-2" />
              Clean completed
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-2">
            <h2 className="text-sm font-medium">Active / recent tasks</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tasks yet. Click Add task to create one.
              </p>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`border rounded p-3 ${
                      selectedTaskId === task.id ? "border-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium">{task.kind}</span>
                        {" — "}
                        <span className="text-muted-foreground text-sm">
                          {task.kind === "file.convert"
                            ? `${String(task.request?.input ?? "?")} → ${String(task.request?.output ?? "?")}`
                            : task.kind === "expression.analyze"
                              ? `pos ${String(task.request?.pos ?? "?")} ch${String(task.request?.channel ?? "?")} → ${String(task.request?.output ?? "?")}`
                              : task.kind === "kill.predict"
                                ? `pos ${String(task.request?.pos ?? "?")} → ${String(task.request?.output ?? "?")}`
                                : task.kind === "tissue.analyze"
                                  ? `pos ${String(task.request?.pos ?? "?")} → ${String(task.request?.output ?? "?")}`
                                  : `pos ${String(task.request?.pos ?? "?")} → ${String(task.request?.output ?? "?")}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center h-8 text-sm px-3 rounded ${
                            task.status === "running"
                              ? "bg-primary/20"
                              : task.status === "succeeded"
                                ? "bg-green-500/20"
                                : task.status === "failed"
                                  ? "bg-destructive/20"
                                  : "bg-muted"
                          }`}
                        >
                          {task.status}
                        </span>
                        {task.status === "succeeded" && (
                          <>
                            {task.kind === "file.convert" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate("/workspace")}
                              >
                                Add output as workspace
                              </Button>
                            ) : task.kind === "expression.analyze" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const r = task.result as {
                                    rows?: Array<{
                                      t: number;
                                      crop: string;
                                      intensity: number;
                                      area: number;
                                      background: number;
                                    }>;
                                  } | null;
                                  navigate("/application", {
                                    state: { expressionRows: r?.rows ?? null },
                                  });
                                }}
                              >
                                View in Application
                              </Button>
                            ) : task.kind === "kill.predict" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const r = task.result as {
                                    rows?: Array<{ t: number; crop: string; label: boolean }>;
                                  } | null;
                                  navigate("/application", {
                                    state: { killRows: r?.rows ?? null },
                                  });
                                }}
                              >
                                View in Application
                              </Button>
                            ) : task.kind === "tissue.analyze" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const r = task.result as {
                                    rows?: Array<{
                                      t: number;
                                      crop: string;
                                      cell: number;
                                      total_fluorescence: number;
                                      cell_area: number;
                                      background: number;
                                    }>;
                                  } | null;
                                  navigate("/application", {
                                    state: { tissueRows: r?.rows ?? null },
                                  });
                                }}
                              >
                                View in Application
                              </Button>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => navigate("/see")}>
                                View in See
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {selectedTaskId === task.id && (
                      <div className="mt-2 pt-2 border-t text-sm space-y-1">
                        {task.status === "failed" && task.error && (
                          <p className="text-destructive font-medium">{task.error}</p>
                        )}
                        {task.progress_events.length > 0 && (
                          <p>
                            {task.progress_events[task.progress_events.length - 1]?.message ?? ""}
                          </p>
                        )}
                        {task.logs.length > 0 && (
                          <pre className="text-xs overflow-auto max-h-24">
                            {task.logs.join("\n")}
                          </pre>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="text-xs text-muted-foreground mt-1"
                      onClick={() => setSelectedTaskId((id) => (id === task.id ? null : task.id))}
                    >
                      {selectedTaskId === task.id ? "Collapse" : "Expand"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConvertTaskConfigModal
        open={convertModalOpen}
        onClose={() => setConvertModalOpen(false)}
        defaultOutputPath={activeWorkspace?.rootPath ?? null}
        onCreate={handleCreateConvert}
      />

      {activeWorkspace && (
        <>
          <CropTaskConfigModal
            key={`crop-${activeWorkspace.id}`}
            open={cropModalOpen}
            onClose={() => setCropModalOpen(false)}
            workspace={activeWorkspace}
            onCreate={handleCreateCrop}
            positionsWithBbox={positionsWithBboxResolved}
          />
          <MovieTaskConfigModal
            key={`movie-${activeWorkspace.id}`}
            open={movieModalOpen}
            onClose={() => setMovieModalOpen(false)}
            workspace={activeWorkspace}
            onCreate={handleCreateMovie}
          />
          <ExpressionTaskConfigModal
            key={`expression-${activeWorkspace.id}`}
            open={expressionModalOpen}
            onClose={() => setExpressionModalOpen(false)}
            workspace={activeWorkspace}
            onCreate={handleCreateExpressionAnalyze}
          />
          <KillTaskConfigModal
            key={`kill-${activeWorkspace.id}`}
            open={killModalOpen}
            onClose={() => setKillModalOpen(false)}
            workspace={activeWorkspace}
            onCreate={handleCreateKillPredict}
          />
          <TissueTaskConfigModal
            key={`tissue-${activeWorkspace.id}`}
            open={tissueModalOpen}
            onClose={() => setTissueModalOpen(false)}
            workspace={activeWorkspace}
            onCreate={handleCreateTissueAnalyze}
          />
        </>
      )}
    </div>
  );
}

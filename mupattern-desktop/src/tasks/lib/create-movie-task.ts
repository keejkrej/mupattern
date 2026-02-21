/**
 * Create a movie task (persist to SQLite, run in background, toast).
 * Used from See (context menu) and Tasks (modal).
 */

import { toast } from "sonner";

export interface TaskRecord {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  logs: string[];
  progress_events: Array<{ progress: number; message: string; timestamp: string }>;
}

export interface CreateMovieParams {
  input_zarr: string;
  pos: number;
  crop: number;
  channel: number;
  time: string;
  output: string;
  fps: number;
  colormap: string;
  spots: string | null;
}

export async function createMovieTask(params: CreateMovieParams): Promise<void> {
  const taskId = crypto.randomUUID();
  const task: TaskRecord = {
    id: taskId,
    kind: "file.movie",
    status: "running",
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: null,
    request: { ...params } as Record<string, unknown>,
    result: null,
    error: null,
    logs: [],
    progress_events: [],
  };

  await window.mupatternDesktop.tasks.insertTask(task);
  toast.success("Movie task created");

  const unsub = window.mupatternDesktop.tasks.onMovieProgress(() => {
    // Progress events are persisted by main process
  });

  try {
    const result = await window.mupatternDesktop.tasks.runMovie({
      taskId,
      ...params,
    });
    unsub();
    if (result.ok) {
      toast.success(`Movie saved to ${params.output}`);
    } else {
      toast.error(result.error ?? "Movie task failed");
    }
  } catch (e) {
    unsub();
    const msg = e instanceof Error ? e.message : String(e);
    toast.error(msg);
  }
}

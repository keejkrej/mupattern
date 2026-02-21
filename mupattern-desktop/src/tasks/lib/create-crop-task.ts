/**
 * Create a crop task (persist to SQLite, run in background, toast).
 * Used from WorkspaceDashboard (context menu) and Tasks (modal).
 */

import { toast } from "sonner";

export interface CreateCropParams {
  input_dir: string;
  pos: number;
  bbox: string;
  output: string;
  background: boolean;
}

export async function createCropTask(params: CreateCropParams): Promise<void> {
  const taskId = crypto.randomUUID();

  const task = {
    id: taskId,
    kind: "file.crop",
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

  await window.mupatternDesktop.tasks.insertTask(task);
  toast.success("Crop task created");

  const unsub = window.mupatternDesktop.tasks.onCropProgress(() => {});

  try {
    const result = await window.mupatternDesktop.tasks.runCrop({
      taskId,
      ...params,
    });
    unsub();
    if (result.ok) {
      toast.success(`Crops saved to ${params.output}`);
    } else {
      toast.error(result.error ?? "Crop task failed");
    }
  } catch (e) {
    unsub();
    const msg = e instanceof Error ? e.message : String(e);
    toast.error(msg);
  }
}

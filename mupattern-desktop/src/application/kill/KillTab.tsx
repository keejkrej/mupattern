import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@mupattern/shared";
import type { Workspace } from "@/workspace/store";

interface KillRow {
  t: number;
  crop: string;
  label: boolean;
}

interface KillTask {
  id: string;
  kind: string;
  status: string;
  request: { pos?: number; output?: string };
  result: { output: string; rows: KillRow[] } | null;
}

interface KillTabProps {
  workspace: Workspace;
  initialRows?: KillRow[] | null;
}

function applyClean(rows: KillRow[]): KillRow[] {
  const byCrop = new Map<string, KillRow[]>();
  for (const r of rows) {
    let arr = byCrop.get(r.crop);
    if (!arr) {
      arr = [];
      byCrop.set(r.crop, arr);
    }
    arr.push(r);
  }
  const result: KillRow[] = [];
  for (const [, arr] of byCrop) {
    arr.sort((a, b) => a.t - b.t);
    let seenFalse = false;
    for (const row of arr) {
      if (!row.label) seenFalse = true;
      else if (seenFalse) result.push({ ...row, label: false });
      else result.push(row);
    }
  }
  result.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.crop.localeCompare(b.crop)));
  return result;
}

export function KillTab({ workspace: _workspace, initialRows }: KillTabProps) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<KillRow[] | null>(initialRows ?? null);
  const [cleaned, setCleaned] = useState(false);
  const [tasks, setTasks] = useState<KillTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  useEffect(() => {
    if (initialRows && initialRows.length > 0) setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTasks(true);
    window.mupatternDesktop.tasks
      .listTasks()
      .then((list) => {
        if (cancelled) return;
        const kill = (list as unknown as KillTask[]).filter(
          (t) => t.kind === "kill.predict" && t.status === "succeeded" && t.result?.rows?.length,
        );
        setTasks(kill);
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const displayRows = useMemo(() => {
    if (!rows) return null;
    return cleaned ? applyClean(rows) : rows;
  }, [rows, cleaned]);

  const { curveData, deathTimes } = useMemo((): {
    curveData: Array<{ t: number; n: number }>;
    deathTimes: number[];
  } => {
    if (!displayRows || displayRows.length === 0) return { curveData: [], deathTimes: [] };
    const byT = new Map<number, number>();
    const deaths: number[] = [];
    const byCrop = new Map<string, KillRow[]>();
    for (const r of displayRows) {
      let arr = byCrop.get(r.crop);
      if (!arr) {
        arr = [];
        byCrop.set(r.crop, arr);
      }
      arr.push(r);
    }
    for (const [, arr] of byCrop) {
      arr.sort((a, b) => a.t - b.t);
      const firstFalse = arr.find((r) => !r.label);
      if (firstFalse && firstFalse.t > 0) deaths.push(firstFalse.t);
    }
    for (const r of displayRows) {
      if (!byT.has(r.t)) byT.set(r.t, 0);
      if (r.label) byT.set(r.t, byT.get(r.t)! + 1);
    }
    const curveData = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ t, n }));
    return { curveData, deathTimes };
  }, [displayRows]);

  const histData = useMemo(() => {
    if (deathTimes.length === 0) return [];
    const maxT = Math.max(...deathTimes, 1);
    const bins = new Map<number, number>();
    for (let t = 1; t <= maxT; t++) bins.set(t, 0);
    for (const t of deathTimes) bins.set(t, (bins.get(t) ?? 0) + 1);
    return [...bins.entries()].map(([t, n]) => ({ t, n }));
  }, [deathTimes]);

  return (
    <div className="space-y-6">
      {!rows || rows.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Add a Kill predict task from the Tasks page, run it, then click &quot;View in
            Application&quot; — or pick a completed task below.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("/tasks")}>
            Go to Tasks
          </Button>
          {loadingTasks ? (
            <p className="text-sm text-muted-foreground">Loading tasks…</p>
          ) : tasks.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Completed kill tasks</p>
              <div className="flex flex-wrap gap-2">
                {tasks.map((t) => (
                  <Button
                    key={t.id}
                    variant="outline"
                    size="sm"
                    onClick={() => t.result?.rows && setRows(t.result.rows)}
                  >
                    pos {t.request?.pos ?? "?"} ({t.result?.rows?.length ?? 0} rows)
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {rows && rows.length > 0 && (
        <div className="space-y-8">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {rows.length} rows from kill predict
              {cleaned && " (cleaned)"}
            </span>
            <div className="flex gap-2">
              <Button
                variant={cleaned ? "outline" : "ghost"}
                size="sm"
                onClick={() => setCleaned((c) => !c)}
              >
                {cleaned ? "Show original" : "Apply clean"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRows(null)}>
                Choose different task
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
            <div>
              <h3 className="text-sm font-medium mb-2">Kill curve (n cells present)</h3>
              <div className="h-64 [&_*]:pointer-events-none">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curveData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="t" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="n"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2">Death time distribution</h3>
              <div className="h-64 [&_*]:pointer-events-none">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="t" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Bar dataKey="n" fill="hsl(var(--destructive))" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

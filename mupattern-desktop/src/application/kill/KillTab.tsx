import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  Area,
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

const CLEAN_THRESHOLD = 0.8;
const HIST_BIN_WIDTH = 5;

/**
 * Per-pattern: find the longest span [first frame, last true] with ≥80% true.
 * Death time = span end (chosenEnd). If span duration = 1, set 0 (misdetection, neglected in histogram).
 */
function computeDeathTimes(rows: KillRow[]): Map<string, number> {
  const byCrop = new Map<string, KillRow[]>();
  for (const r of rows) {
    let arr = byCrop.get(r.crop);
    if (!arr) {
      arr = [];
      byCrop.set(r.crop, arr);
    }
    arr.push(r);
  }
  const deathTimes = new Map<string, number>();
  for (const [crop, arr] of byCrop) {
    arr.sort((a, b) => a.t - b.t);
    const tMin = arr[0]!.t;
    const trueTs = [...new Set(arr.filter((r) => r.label).map((r) => r.t))].sort((a, b) => a - b);
    if (trueTs.length === 0) {
      deathTimes.set(crop, 0);
      continue;
    }
    let chosenEnd = -1;
    for (let i = trueTs.length - 1; i >= 0; i--) {
      const end = trueTs[i]!;
      const span = arr.filter((r) => r.t >= tMin && r.t <= end);
      const nTrue = span.filter((r) => r.label).length;
      if (span.length > 0 && nTrue / span.length >= CLEAN_THRESHOLD) {
        chosenEnd = end;
        break;
      }
    }
    if (chosenEnd < 0) chosenEnd = trueTs[0]!;
    const spanDuration = chosenEnd - tMin + 1;
    deathTimes.set(crop, spanDuration === 1 ? 0 : chosenEnd);
  }
  return deathTimes;
}

export function KillTab({ workspace: _workspace, initialRows }: KillTabProps) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<KillRow[] | null>(initialRows ?? null);
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

  const { curveData, deathTimes, cropCount } = useMemo((): {
    curveData: Array<{ t: number; n: number }>;
    deathTimes: number[];
    cropCount: number;
  } => {
    if (!rows || rows.length === 0) return { curveData: [], deathTimes: [], cropCount: 0 };
    const dt = computeDeathTimes(rows);
    const cropCount = dt.size;
    const deaths = [...dt.values()];
    const maxT = Math.max(
      ...rows.map((r) => r.t),
      ...deaths,
      0,
    );
    const byT = new Map<number, number>();
    for (let t = 0; t <= maxT; t++) {
      const nAlive = [...dt.values()].filter((d) => d > 0 && d >= t).length;
      byT.set(t, nAlive);
    }
    let curveData = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ t, n }));
    if (curveData.length === 1) {
      curveData = [{ t: Math.max(0, curveData[0]!.t - 1), n: 0 }, curveData[0]!];
    }
    return { curveData, deathTimes: deaths, cropCount };
  }, [rows]);

  const histData = useMemo(() => {
    const filtered = deathTimes.filter((t) => t > 0);
    if (filtered.length === 0) return [];
    const maxT = Math.max(...filtered, 1);
    const binWidth = Math.max(1, HIST_BIN_WIDTH);
    const binEdges: number[] = [];
    for (let e = 1; e <= maxT + 1; e += binWidth) binEdges.push(e);
    if (binEdges[binEdges.length - 1]! <= maxT) binEdges.push(maxT + 1);
    const result: Array<{ t: number; n: number }> = [];
    for (let i = 0; i < binEdges.length - 1; i++) {
      const lo = binEdges[i]!;
      const hi = binEdges[i + 1]!;
      const tCenter = (lo + hi - 1) / 2;
      const n = filtered.filter((d) => d >= lo && d < hi).length;
      result.push({ t: tCenter, n });
    }
    return result;
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
          <span className="text-sm text-muted-foreground">{cropCount} patterns</span>

          <div className="flex flex-col gap-6 w-full">
            <div className="min-w-0">
              <h3 className="text-sm font-medium mb-2">
                Kill curve (n cells present)
                {curveData.length > 0 && (
                  <span className="font-normal text-muted-foreground ml-1">
                    — {curveData.length} points
                  </span>
                )}
              </h3>
              <div className="h-[32rem] w-full min-w-0 [&_*]:pointer-events-none">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={curveData} margin={{ top: 5, right: 5, left: 5, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="t"
                      tick={{ fontSize: 12 }}
                      label={{ value: "frame", position: "bottom", offset: -5 }}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      domain={[0, "auto"]}
                      label={{ value: "n alive", angle: -90, position: "insideLeft" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="n"
                      fill="rgba(70, 130, 180, 0.25)"
                      stroke="none"
                      baseValue={0}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="n"
                      stroke="rgb(70, 130, 180)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium mb-2">Death time distribution</h3>
              <div className="h-[32rem] w-full min-w-0 [&_*]:pointer-events-none">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={histData} margin={{ top: 5, right: 5, left: 5, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="t"
                      tick={{ fontSize: 12 }}
                      label={{ value: "frame at death", position: "bottom", offset: -5 }}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      label={{ value: "frequency", angle: -90, position: "insideLeft" }}
                    />
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

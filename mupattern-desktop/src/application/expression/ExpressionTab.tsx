import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Button } from "@mupattern/shared";
import type { Workspace } from "@/workspace/store";

export interface ExpressionRow {
  t: number;
  crop: string;
  intensity: number;
  area: number;
  background: number;
}

/** Gray at 30% opacity for bulk time-series display (no per-series legend) */
const BULK_LINE_STROKE = "rgba(128, 128, 128, 0.3)";

interface ExpressionTabProps {
  workspace: Workspace;
  rows: ExpressionRow[] | null;
}

export function ExpressionTab({ workspace: _workspace, rows }: ExpressionTabProps) {
  const navigate = useNavigate();

  const crops = rows ? [...new Set(rows.map((r) => r.crop))].sort() : [];
  const pivotByT = (mapper: (r: ExpressionRow) => number) => {
    if (!rows) return [];
    const byT = new Map<number, Record<string, number>>();
    for (const r of rows) {
      let row = byT.get(r.t);
      if (!row) {
        row = {};
        byT.set(r.t, row);
      }
      row[r.crop] = mapper(r);
    }
    return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, row]) => ({ t, ...row }));
  };

  const intensityAboveBgData = pivotByT((r) => r.intensity - r.area * r.background);

  const dataWithMedian = useMemo(() => {
    if (!intensityAboveBgData.length || crops.length === 0) return intensityAboveBgData;
    return intensityAboveBgData.map((row) => {
      const values = crops
        .map((c) => (row as Record<string, number>)[c])
        .filter((v) => typeof v === "number" && !Number.isNaN(v));
      const median =
        values.length === 0
          ? NaN
          : (() => {
              const sorted = [...values].sort((a, b) => a - b);
              const m = Math.floor(sorted.length / 2);
              return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
            })();
      return { ...row, median };
    });
  }, [intensityAboveBgData, crops]);

  return (
    <div className="space-y-6">
      {!rows || rows.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Select a position from the left sidebar to view expression data, or run an Expression
            analyze task from the Tasks page.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("/tasks")}>
            Go to Tasks
          </Button>
        </div>
      ) : null}

      {rows && rows.length > 0 && (
        <div className="space-y-8">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              {crops.length} trace{crops.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Background-corrected total fluorescence</h3>
            <div className="h-[32rem] flex [&_*]:pointer-events-none">
              <div
                className="flex items-center justify-center pr-1 shrink-0 text-sm text-muted-foreground"
                style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
              >
                fluorescence
              </div>
              <div className="flex-1 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={dataWithMedian}
                    margin={{ top: 5, right: 5, left: 5, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="t"
                      tick={{ fontSize: 12 }}
                      domain={["dataMin", "dataMax"]}
                      label={{ value: "frame", position: "bottom", offset: -5 }}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => Number(v).toExponential(1)}
                      domain={["dataMin", "dataMax"]}
                    />
                    <Tooltip cursor={false} content={() => null} />
                    {crops.map((crop) => (
                      <Line
                        key={crop}
                        type="monotone"
                        dataKey={crop}
                        stroke={BULK_LINE_STROKE}
                        strokeWidth={1}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                        legendType="none"
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="median"
                      name="median"
                      stroke="red"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                      legendType="line"
                    />
                    <Legend align="left" verticalAlign="top" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

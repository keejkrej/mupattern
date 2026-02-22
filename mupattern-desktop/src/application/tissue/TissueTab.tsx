import { useMemo, useState } from "react";
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
import type { TissueRow } from "./TissueLeftSidebar";

/** Gray at 30% opacity for bulk time-series display */
const BULK_LINE_STROKE = "rgba(128, 128, 128, 0.3)";

interface TissueTabProps {
  workspace: Workspace;
  rows: TissueRow[] | null;
}

export function TissueTab({ workspace: _workspace, rows }: TissueTabProps) {
  const navigate = useNavigate();
  const [gfpThreshold, setGfpThreshold] = useState(0.5);


  const gfpRows = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      const meanAboveBg = r.total_fluorescence / r.cell_area - r.background;
      return meanAboveBg > gfpThreshold;
    });
  }, [rows, gfpThreshold]);

  const fluoAboveBg = (r: TissueRow) => r.total_fluorescence - r.cell_area * r.background;

  const pivotByT = useMemo(() => {
    if (!gfpRows.length) return [];
    const byCropT = new Map<string, number[]>();
    for (const r of gfpRows) {
      const key = `${r.crop}\t${r.t}`;
      const arr = byCropT.get(key) ?? [];
      arr.push(fluoAboveBg(r));
      byCropT.set(key, arr);
    }
    const byT = new Map<number, Record<string, number>>();
    for (const [key, vals] of byCropT) {
      const [crop, tStr] = key.split("\t");
      const t = Number.parseInt(tStr ?? "0", 10);
      const sorted = [...vals].sort((a, b) => a - b);
      const m = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[m] : (sorted[m - 1]! + sorted[m]!) / 2;
      let row = byT.get(t);
      if (!row) {
        row = { t };
        byT.set(t, row);
      }
      (row as Record<string, number>)[crop] = median;
    }
    return [...byT.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => row);
  }, [gfpRows]);

  const cropsInChart = useMemo(
    () => [...new Set(gfpRows.map((r) => r.crop))].sort(),
    [gfpRows],
  );

  const dataWithMedian = useMemo(() => {
    if (!pivotByT.length || !cropsInChart.length) return pivotByT;
    return pivotByT.map((row) => {
      const values = cropsInChart
        .map((c) => (row[c] as number))
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
  }, [pivotByT, cropsInChart]);

  return (
    <div className="space-y-6">
      {!rows || rows.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Select a position from the left sidebar to view tissue data, or run a Tissue analyze
            task from the Tasks page.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("/tasks")}>
            Go to Tasks
          </Button>
        </div>
      ) : null}

      {rows && rows.length > 0 && (
        <div className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">GFP+ threshold</label>
              <input
                type="number"
                step="0.1"
                min="0"
                className="w-20 border rounded px-2 py-1 bg-background text-sm"
                value={gfpThreshold}
                onChange={(e) => setGfpThreshold(Number(e.target.value))}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              GFP+ cells:{" "}
              {rows.filter(
                (r) =>
                  r.total_fluorescence / r.cell_area - r.background >
                  gfpThreshold,
              ).length}
            </span>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">
              Median fluorescence per crop (GFP+ cells, total − area×background)
            </h3>
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
                    {cropsInChart.map((crop) => (
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

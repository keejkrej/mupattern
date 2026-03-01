import { useEffect, useMemo, useRef, useState } from "react";
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
import { Button, Slider } from "@mupattern/shared";
import type { Workspace } from "@/workspace/store";
import type { ExpressionTraceSeries, ExpressionTraceMetrics } from "./types";

const BULK_LINE_STROKE = "rgba(128, 128, 128, 0.3)";
const LOG_RETURN_MIN_CONSECUTIVE = 2;
const DEFAULT_LOG_RETURN_THRESHOLD = Math.log(0.5);
const TEN_STEP_MAX_INDEX = 9;

interface ExpressionTabProps {
  workspace: Workspace;
  series: ExpressionTraceSeries[] | null;
  metrics: ExpressionTraceMetrics[] | null;
  datasetId: string | null;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] ?? Number.NaN : ((sorted[m - 1] ?? 0) + (sorted[m] ?? 0)) / 2;
}

function valueFromTenStep(min: number, max: number, stepIndex: number): number {
  const clamped = Math.max(0, Math.min(TEN_STEP_MAX_INDEX, Math.round(stepIndex)));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return min;
  const frac = clamped / TEN_STEP_MAX_INDEX;
  return min + frac * (max - min);
}

function stepFromValue(min: number, max: number, value: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round(((clamped - min) / (max - min)) * TEN_STEP_MAX_INDEX);
}

export function ExpressionTab({ workspace: _workspace, series, metrics, datasetId }: ExpressionTabProps) {
  const navigate = useNavigate();
  const [alignFirstToZero, setAlignFirstToZero] = useState(true);
  const [hideFlatTraces, setHideFlatTraces] = useState(true);
  const [hideDropTraces, setHideDropTraces] = useState(true);

  const [draftFlatnessStep, setDraftFlatnessStep] = useState(0);
  const [appliedFlatnessStep, setAppliedFlatnessStep] = useState(0);
  const [draftLogReturnStep, setDraftLogReturnStep] = useState(0);
  const [appliedLogReturnStep, setAppliedLogReturnStep] = useState(0);

  const [selectedCrops, setSelectedCrops] = useState<string[]>([]);
  const [totalTraceCount, setTotalTraceCount] = useState(0);
  const [dropTraceCount, setDropTraceCount] = useState(0);
  const [filterError, setFilterError] = useState<string | null>(null);
  const filterSeqRef = useRef(0);

  const seriesByCrop = useMemo(() => {
    const map = new Map<string, ExpressionTraceSeries>();
    for (const s of series ?? []) map.set(s.crop, s);
    return map;
  }, [series]);

  const metricStats = useMemo(() => {
    const items = metrics ?? [];
    const flatnessScores = items.map((m) => m.flatnessScore).filter((x) => Number.isFinite(x) && x >= 0);
    const minLagReturns = items.map((m) => m.minLagLogReturn).filter((x) => Number.isFinite(x));
    const flatnessMax = flatnessScores.length > 0 ? Math.max(...flatnessScores) : 0;
    const flatnessMedian = median(flatnessScores);
    const minLagLogReturn =
      minLagReturns.length > 0 ? Math.min(...minLagReturns) : DEFAULT_LOG_RETURN_THRESHOLD;
    const medianLagLogReturn = median(minLagReturns);
    return { flatnessMax, flatnessMedian, minLagLogReturn, medianLagLogReturn };
  }, [metrics]);

  const logReturnSliderMin = Math.min(metricStats.minLagLogReturn, DEFAULT_LOG_RETURN_THRESHOLD, -0.01);
  const logReturnSliderMax = 0;
  const flatnessThreshold = valueFromTenStep(0, metricStats.flatnessMax, appliedFlatnessStep);
  const logReturnThreshold = valueFromTenStep(
    logReturnSliderMin,
    logReturnSliderMax,
    appliedLogReturnStep,
  );

  useEffect(() => {
    const flatDefault = 0;
    const logDefault = stepFromValue(logReturnSliderMin, logReturnSliderMax, DEFAULT_LOG_RETURN_THRESHOLD);
    setDraftFlatnessStep(flatDefault);
    setAppliedFlatnessStep(flatDefault);
    setDraftLogReturnStep(logDefault);
    setAppliedLogReturnStep(logDefault);
  }, [metrics, logReturnSliderMin, logReturnSliderMax]);

  useEffect(() => {
    const allCrops = [...seriesByCrop.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    setSelectedCrops(allCrops);
    setTotalTraceCount(allCrops.length);
    setDropTraceCount(0);
    setFilterError(null);
  }, [seriesByCrop]);

  useEffect(() => {
    if (!series || series.length === 0) return;
    if (!datasetId) {
      setFilterError("Expression dataset unavailable for filtering");
      return;
    }

    const seq = ++filterSeqRef.current;
    setFilterError(null);

    void window.mupatternDesktop.application
      .filterExpression({
        datasetId,
        hideFlat: hideFlatTraces,
        flatnessThreshold,
        hideDrop: hideDropTraces,
        logReturnThreshold,
        minConsecutive: LOG_RETURN_MIN_CONSECUTIVE,
      })
      .then((result) => {
        if (seq !== filterSeqRef.current) return;
        if (!result.ok) {
          setFilterError(result.error);
          return;
        }
        setSelectedCrops(result.selectedCrops);
        setTotalTraceCount(result.totalCount);
        setDropTraceCount(result.dropCount);
        setFilterError(null);
      })
      .catch((err) => {
        if (seq !== filterSeqRef.current) return;
        setFilterError(err instanceof Error ? err.message : String(err));
      });
  }, [
    series,
    datasetId,
    hideFlatTraces,
    hideDropTraces,
    flatnessThreshold,
    logReturnThreshold,
  ]);

  const { dataWithMedian, shownCropNames, shownTraceCount } = useMemo(() => {
    const shown = selectedCrops.filter((crop) => seriesByCrop.has(crop));
    const byT = new Map<number, Record<string, number>>();
    for (const crop of shown) {
      const trace = seriesByCrop.get(crop);
      if (!trace) continue;
      const baseline = alignFirstToZero ? (trace.intensity[0] ?? 0) : 0;
      const n = Math.min(trace.t.length, trace.intensity.length);
      for (let i = 0; i < n; i++) {
        const t = trace.t[i] ?? 0;
        const v = (trace.intensity[i] ?? 0) - baseline;
        let row = byT.get(t);
        if (!row) {
          row = { t };
          byT.set(t, row);
        }
        row[crop] = v;
      }
    }

    const chartRows = [...byT.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => {
        const values = shown
          .map((c) => row[c])
          .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
        return { ...row, median: median(values) };
      });

    return {
      dataWithMedian: chartRows,
      shownCropNames: shown,
      shownTraceCount: shown.length,
    };
  }, [selectedCrops, seriesByCrop, alignFirstToZero]);

  const hasData = Boolean(series && series.length > 0);
  const hasMetrics = Boolean(metrics && metrics.length > 0);
  const datasetAvailable = Boolean(datasetId);

  return (
    <div className="space-y-6">
      {!hasData ? (
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

      {hasData && (
        <div className="flex flex-col xl:flex-row gap-6 min-h-0">
          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">
                {shownTraceCount}/{totalTraceCount} traces shown
              </span>
              <h3 className="text-sm font-medium">
                Background-corrected total fluorescence {alignFirstToZero ? "(first frame = 0)" : ""}
              </h3>
            </div>
            {shownTraceCount === 0 ? (
              <p className="text-sm text-muted-foreground">
                No traces pass the current filters. Lower thresholds or disable a trace filter.
              </p>
            ) : (
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
                        domain={[
                          0,
                          (dataMax: number) => (Number.isFinite(dataMax) ? Math.max(0, dataMax) : 0),
                        ]}
                        allowDataOverflow
                      />
                      <Tooltip cursor={false} content={() => null} />
                      {shownCropNames.map((crop) => (
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
            )}
          </div>

          <aside className="w-full xl:w-80 xl:shrink-0 border border-border rounded-md p-4 space-y-5 xl:border-0 xl:border-l xl:rounded-none xl:pl-4 xl:pr-0 xl:py-0">
            <div className="space-y-1">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Trace filters
              </h2>
              <p className="text-xs text-muted-foreground">
                Filtering runs in Rust on slider commit (10 discrete steps).
              </p>
            </div>

            {!datasetAvailable ? (
              <p className="text-xs text-destructive">
                Expression dataset unavailable. Filtering controls are disabled.
              </p>
            ) : null}

            <div className="space-y-2">
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Align first frame to 0</span>
                <input
                  id="expr-align-first-zero"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={alignFirstToZero}
                  onChange={(e) => setAlignFirstToZero(e.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Hide flat traces</span>
                <input
                  id="expr-hide-flat"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={hideFlatTraces}
                  onChange={(e) => setHideFlatTraces(e.target.checked)}
                  disabled={!datasetAvailable}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Hide persistent-drop traces</span>
                <input
                  id="expr-hide-drop"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={hideDropTraces}
                  onChange={(e) => setHideDropTraces(e.target.checked)}
                  disabled={!datasetAvailable}
                />
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Flatness threshold</span>
                <span className="text-xs text-muted-foreground">
                  {flatnessThreshold.toExponential(2)} (step {appliedFlatnessStep + 1}/10)
                </span>
              </div>
              <Slider
                min={0}
                max={TEN_STEP_MAX_INDEX}
                step={1}
                value={[draftFlatnessStep]}
                onValueChange={([v]) => setDraftFlatnessStep(Math.round(v))}
                onValueCommit={([v]) => setAppliedFlatnessStep(Math.round(v))}
                disabled={!hasMetrics || !datasetAvailable}
              />
              <p className="text-xs text-muted-foreground">
                metric = (P90 - P10) / (0.8 * nFrames)
              </p>
              <p className="text-xs text-muted-foreground">
                median score: {metricStats.flatnessMedian.toExponential(2)}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Lag-10 log-return threshold</span>
                <span className="text-xs text-muted-foreground">
                  {logReturnThreshold.toFixed(3)} (step {appliedLogReturnStep + 1}/10)
                </span>
              </div>
              <Slider
                min={0}
                max={TEN_STEP_MAX_INDEX}
                step={1}
                value={[draftLogReturnStep]}
                onValueChange={([v]) => setDraftLogReturnStep(Math.round(v))}
                onValueCommit={([v]) => setAppliedLogReturnStep(Math.round(v))}
                disabled={!hideDropTraces || !hasMetrics || !datasetAvailable}
              />
              <p className="text-xs text-muted-foreground">
                flag if {LOG_RETURN_MIN_CONSECUTIVE}+ consecutive lag-10 log returns are {"<="} threshold
              </p>
              <p className="text-xs text-muted-foreground">
                median per-trace minimum log return: {metricStats.medianLagLogReturn.toFixed(3)}
              </p>
              <p className="text-xs text-muted-foreground">drop traces at threshold: {dropTraceCount}</p>
            </div>

            {filterError ? <p className="text-xs text-destructive">{filterError}</p> : null}

            {!hasMetrics ? (
              <p className="text-xs text-muted-foreground">
                No precomputed metrics found for this dataset.
              </p>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const flatDefault = 0;
                const logDefault = stepFromValue(
                  logReturnSliderMin,
                  logReturnSliderMax,
                  DEFAULT_LOG_RETURN_THRESHOLD,
                );
                setDraftFlatnessStep(flatDefault);
                setAppliedFlatnessStep(flatDefault);
                setDraftLogReturnStep(logDefault);
                setAppliedLogReturnStep(logDefault);
              }}
              disabled={!hasMetrics || !datasetAvailable}
            >
              Reset Filters
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}

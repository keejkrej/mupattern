export interface ExpressionTraceSeries {
  crop: string;
  t: number[];
  intensity: number[];
}

export interface ExpressionTraceMetrics {
  crop: string;
  rangeP90P10: number;
  flatnessScore: number;
  lagLogReturns: number[];
  minLagLogReturn: number;
}

export interface ExpressionDatasetPayload {
  datasetId: string;
  series: ExpressionTraceSeries[];
  metrics: ExpressionTraceMetrics[];
}

export interface ExpressionFilterRequest {
  datasetId: string;
  hideFlat: boolean;
  flatnessThreshold: number;
  hideDrop: boolean;
  logReturnThreshold: number;
  minConsecutive: number;
}

export interface ExpressionFilterResult {
  selectedCrops: string[];
  totalCount: number;
  dropCount: number;
}

/**
 * Convert between position tags and YAML dict format: { [tag: string]: slice: string }
 */
import type { PositionTag } from "@/workspace/store";

/**
 * Convert posTags to dict of label -> slice string.
 * Tags with the same label are merged into a slice expression.
 */
export function posTagsToDict(positions: number[], posTags: PositionTag[]): Record<string, string> {
  const byLabel = new Map<string, number[]>();
  for (const tag of posTags) {
    const vals: number[] = [];
    for (let i = tag.startIndex; i <= tag.endIndex; i++) {
      const v = positions[i];
      if (v !== undefined) vals.push(v);
    }
    const existing = byLabel.get(tag.label) ?? [];
    byLabel.set(
      tag.label,
      [...new Set([...existing, ...vals])].sort((a, b) => a - b),
    );
  }
  const dict: Record<string, string> = {};
  for (const [label, vals] of byLabel) {
    if (vals.length === 0) continue;
    const parts: string[] = [];
    let runStart = vals[0];
    let runEnd = vals[0];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] === runEnd + 1) {
        runEnd = vals[i];
        continue;
      }
      parts.push(runStart === runEnd ? String(runStart) : `${runStart}:${runEnd + 1}`);
      runStart = vals[i];
      runEnd = vals[i];
    }
    parts.push(runStart === runEnd ? String(runStart) : `${runStart}:${runEnd + 1}`);
    dict[label] = parts.join(",");
  }
  return dict;
}

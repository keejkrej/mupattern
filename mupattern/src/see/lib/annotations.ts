/**
 * Annotation persistence: save/load a Map<string, boolean> as CSV.
 *
 * CSV format:
 *   t,crop,label
 *   0,042,true
 *   3,100,false
 */

export type Annotations = Map<string, boolean>;

export function annotationKey(pos: string, t: number, cropId: string): string {
  return `${pos}:${t}:${cropId}`;
}

export function parseKey(key: string): { pos: string; t: number; cropId: string } {
  const [pos, tStr, cropId] = key.split(":");
  return { pos, t: parseInt(tStr, 10), cropId };
}

export function toCSV(annotations: Annotations, pos: string): string {
  const rows = ["t,crop,label"];
  for (const [key, label] of annotations) {
    const parsed = parseKey(key);
    if (parsed.pos !== pos) continue;
    rows.push(`${parsed.t},${parsed.cropId},${label}`);
  }
  return rows.join("\n");
}

export function fromCSV(csv: string, pos: string): Annotations {
  const map: Annotations = new Map();
  const lines = csv.trim().split("\n");
  // skip header
  for (let i = 1; i < lines.length; i++) {
    const [tStr, cropId, labelStr] = lines[i].split(",");
    if (tStr && cropId && labelStr) {
      map.set(annotationKey(pos, parseInt(tStr, 10), cropId), labelStr === "true");
    }
  }
  return map;
}

export function downloadCSV(annotations: Annotations, pos: string, filename: string) {
  const csv = toCSV(annotations, pos);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function uploadCSV(pos: string): Promise<Annotations> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error("No file selected"));
      const text = await file.text();
      resolve(fromCSV(text, pos));
    };
    input.click();
  });
}

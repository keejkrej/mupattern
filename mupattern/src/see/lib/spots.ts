/**
 * Spot overlay: load a CSV of detected spots and group by (t, crop).
 *
 * CSV format (from muspot):
 *   t,crop,spot,y,x
 *   0,042,0,12.5,8.3
 *   0,042,1,20.1,15.7
 */

export interface Spot {
  y: number;
  x: number;
}

export type SpotMap = Map<string, Spot[]>;

export function spotKey(pos: string, t: number, cropId: string): string {
  return `${pos}:${t}:${cropId}`;
}

export function fromCSV(csv: string, pos: string): SpotMap {
  const map: SpotMap = new Map();
  const lines = csv.trim().split("\n");
  // skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 5) continue;
    const [tStr, cropId, , yStr, xStr] = parts;
    const key = spotKey(pos, parseInt(tStr, 10), cropId);
    const list = map.get(key) ?? [];
    list.push({ y: parseFloat(yStr), x: parseFloat(xStr) });
    map.set(key, list);
  }
  return map;
}

export function uploadSpotCSV(pos: string): Promise<SpotMap> {
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

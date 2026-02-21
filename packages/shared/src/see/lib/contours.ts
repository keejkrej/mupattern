/**
 * Extract ordered contours from a label map (uint32 H×W).
 * Each label id (excluding 0) yields one contour as an array of { x, y } in pixel coordinates.
 */

export interface ContourPoint {
  x: number;
  y: number;
}

const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const DX4 = [0, 1, 0, -1];
const DY4 = [-1, 0, 1, 0];

function isBoundary(
  data: Uint32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  id: number,
): boolean {
  if (data[y * width + x] !== id) return false;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX4[d];
    const ny = y + DY4[d];
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      if (data[ny * width + nx] !== id) return true;
    } else {
      return true;
    }
  }
  return false;
}

function traceContour(
  _data: Uint32Array,
  width: number,
  height: number,
  _id: number,
  startX: number,
  startY: number,
  boundarySet: Set<number>,
): ContourPoint[] {
  const key = (y: number, x: number) => y * width + x;
  const contour: ContourPoint[] = [{ x: startX, y: startY }];
  let cx = startX;
  let cy = startY;
  let cameFrom = 4;
  const startKey = key(startY, startX);

  for (;;) {
    let nextFound = false;
    for (let i = 1; i <= 8; i++) {
      const d = (cameFrom + i) % 8;
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && boundarySet.has(key(ny, nx))) {
        contour.push({ x: nx, y: ny });
        cx = nx;
        cy = ny;
        cameFrom = (d + 4) % 8;
        nextFound = true;
        if (key(cy, cx) === startKey && contour.length > 2) {
          contour.pop();
          return contour;
        }
        break;
      }
    }
    if (!nextFound) break;
  }
  return contour;
}

/**
 * Compute one ordered contour per label (id > 0) from a (height × width) label map.
 */
export function labelMapToContours(
  data: Uint32Array,
  width: number,
  height: number,
): ContourPoint[][] {
  const contours: ContourPoint[][] = [];
  const seen = new Set<number>();
  const labels = new Map<number, { x: number; y: number }[]>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = data[y * width + x];
      if (id === 0) continue;
      if (!isBoundary(data, width, height, x, y, id)) continue;
      const k = y * width + x;
      if (seen.has(k)) continue;
      if (!labels.has(id)) labels.set(id, []);
      labels.get(id)!.push({ x, y });
    }
  }

  for (const [, boundaryPixels] of labels) {
    if (boundaryPixels.length === 0) continue;
    boundaryPixels.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
    const start = boundaryPixels[0];
    const boundarySet = new Set(boundaryPixels.map((p) => p.y * width + p.x));
    const id = data[start.y * width + start.x];
    const contour = traceContour(data, width, height, id, start.x, start.y, boundarySet);
    if (contour.length >= 2) contours.push(contour);
  }

  return contours;
}

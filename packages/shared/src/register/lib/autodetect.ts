/** Auto-detect grid points via local-variance binarization → distance transform → peak detection. */
import { normalizeAngleRad } from "./units";

/** Convert RGBA ImageData to grayscale float array. */
export function toGrayscale(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return gray;
}

/** Compute local variance using integral images (sum and sum-of-squares). */
export function localVariance(
  gray: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  const n = w * h;
  const intSum = new Float64Array(n);
  const intSq = new Float64Array(n);

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const v = gray[idx];
      rowSum += v;
      rowSq += v * v;
      intSum[idx] = rowSum + (y > 0 ? intSum[idx - w] : 0);
      intSq[idx] = rowSq + (y > 0 ? intSq[idx - w] : 0);
    }
  }

  const out = new Float32Array(n);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(x - radius, 0);
      const y0 = Math.max(y - radius, 0);
      const x1 = Math.min(x + radius, w - 1);
      const y1 = Math.min(y + radius, h - 1);

      const br = y1 * w + x1;
      const tl = y0 > 0 && x0 > 0 ? (y0 - 1) * w + (x0 - 1) : -1;
      const tr = y0 > 0 ? (y0 - 1) * w + x1 : -1;
      const bl = x0 > 0 ? y1 * w + (x0 - 1) : -1;

      let sum = intSum[br];
      let sq = intSq[br];
      if (tr >= 0) {
        sum -= intSum[tr];
        sq -= intSq[tr];
      }
      if (bl >= 0) {
        sum -= intSum[bl];
        sq -= intSq[bl];
      }
      if (tl >= 0) {
        sum += intSum[tl];
        sq += intSq[tl];
      }

      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = sum / count;
      out[y * w + x] = sq / count - mean * mean;
    }
  }

  return out;
}

/** Otsu's method: find optimal threshold for a float array. */
export function otsuThreshold(data: Float32Array): number {
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < minVal) minVal = data[i];
    if (data[i] > maxVal) maxVal = data[i];
  }
  if (maxVal === minVal) return minVal;

  const bins = 256;
  const hist = new Float64Array(bins);
  const range = maxVal - minVal;

  for (let i = 0; i < data.length; i++) {
    const bin = Math.min(Math.floor(((data[i] - minVal) / range) * (bins - 1)), bins - 1);
    hist[bin]++;
  }

  const total = data.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let bestVariance = 0;
  let bestThreshBin = 0;

  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += i * hist[i];
    const meanB = sumB / wB;
    const meanF = (sumAll - sumB) / wF;
    const diff = meanB - meanF;
    const betweenVar = wB * wF * diff * diff;

    if (betweenVar > bestVariance) {
      bestVariance = betweenVar;
      bestThreshBin = i;
    }
  }

  return minVal + (bestThreshBin / (bins - 1)) * range;
}

/** Erode binary image: pixel = 1 only if all pixels in (2r+1)×(2r+1) neighborhood are 1. */
export function erode(src: Float64Array, w: number, h: number, r: number): Float64Array {
  const dst = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let allOne = true;
      for (let dy = -r; dy <= r && allOne; dy++) {
        for (let dx = -r; dx <= r && allOne; dx++) {
          const ny = y + dy,
            nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w || src[ny * w + nx] === 0) {
            allOne = false;
          }
        }
      }
      dst[y * w + x] = allOne ? 1 : 0;
    }
  }
  return dst;
}

/** Dilate binary image: pixel = 1 if any pixel in (2r+1)×(2r+1) neighborhood is 1. */
export function dilate(src: Float64Array, w: number, h: number, r: number): Float64Array {
  const dst = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let anyOne = false;
      for (let dy = -r; dy <= r && !anyOne; dy++) {
        for (let dx = -r; dx <= r && !anyOne; dx++) {
          const ny = y + dy,
            nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && src[ny * w + nx] === 1) {
            anyOne = true;
          }
        }
      }
      dst[y * w + x] = anyOne ? 1 : 0;
    }
  }
  return dst;
}

/** Morphological open (erode → dilate): removes small noise specks. */
export function morphOpen(src: Float64Array, w: number, h: number, r: number): Float64Array {
  return dilate(erode(src, w, h, r), w, h, r);
}

/** Morphological close (dilate → erode): fills small holes/gaps. */
export function morphClose(src: Float64Array, w: number, h: number, r: number): Float64Array {
  return erode(dilate(src, w, h, r), w, h, r);
}

/** Fill interior holes: flood-fill 0-pixels from border, anything unflooded becomes 1. */
export function fillHoles(src: Float64Array, w: number, h: number): Float64Array {
  const dst = new Float64Array(src);
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  const enqueue = (idx: number) => {
    if (!visited[idx] && dst[idx] === 0) {
      visited[idx] = 1;
      queue.push(idx);
    }
  };

  // Seed from all border pixels
  for (let x = 0; x < w; x++) {
    enqueue(x); // top
    enqueue((h - 1) * w + x); // bottom
  }
  for (let y = 0; y < h; y++) {
    enqueue(y * w); // left
    enqueue(y * w + w - 1); // right
  }

  // BFS flood
  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) enqueue(idx - 1);
    if (x < w - 1) enqueue(idx + 1);
    if (y > 0) enqueue(idx - w);
    if (y < h - 1) enqueue(idx + w);
  }

  // Any 0-pixel not reached from border is an interior hole → fill it
  for (let i = 0; i < dst.length; i++) {
    if (dst[i] === 0 && !visited[i]) dst[i] = 1;
  }

  return dst;
}

/**
 * Felzenszwalb-Huttenlocher exact Euclidean distance transform.
 * Input: binary array where 1 = edge (foreground), 0 = background.
 * Output: Euclidean distance from each 0-pixel to nearest 1-pixel (in-place).
 */
export function distanceTransform(buf: Float64Array, w: number, h: number): void {
  const INF = 1e20;
  const n = w * h;

  // Initialize: black (0) pixels = 0 distance, white (1) pixels = INF
  for (let i = 0; i < n; i++) {
    buf[i] = buf[i] === 0 ? 0 : INF;
  }

  // Scratch buffers for 1D transform
  const maxDim = Math.max(w, h);
  const f = new Float64Array(maxDim);
  const d = new Float64Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float64Array(maxDim + 1);

  function dt1d(length: number) {
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    let k = 0;

    for (let q = 1; q < length; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }

    k = 0;
    for (let q = 0; q < length; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  }

  // Transform along columns
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = buf[y * w + x];
    dt1d(h);
    for (let y = 0; y < h; y++) buf[y * w + x] = d[y];
  }

  // Transform along rows
  for (let y = 0; y < h; y++) {
    const offset = y * w;
    for (let x = 0; x < w; x++) f[x] = buf[offset + x];
    dt1d(w);
    for (let x = 0; x < w; x++) buf[offset + x] = d[x];
  }

  // Squared → Euclidean
  for (let i = 0; i < n; i++) {
    buf[i] = Math.sqrt(buf[i]);
  }
}

/** Find local maxima in the distance transform (value > all 8 neighbors), merging nearby peaks. */
export function findPeaks(
  data: Float64Array,
  w: number,
  h: number,
  minVal: number,
  mergeRadius: number = 10,
): Array<{ x: number; y: number }> {
  // Collect all raw local maxima with their DT values
  const raw: Array<{ x: number; y: number; val: number }> = [];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const val = data[idx];
      if (val < minVal) continue;

      if (
        val > data[idx - 1] &&
        val > data[idx + 1] &&
        val > data[idx - w] &&
        val > data[idx + w] &&
        val > data[idx - w - 1] &&
        val > data[idx - w + 1] &&
        val > data[idx + w - 1] &&
        val > data[idx + w + 1]
      ) {
        raw.push({ x, y, val });
      }
    }
  }

  // Sort by DT value descending so strongest peaks win
  raw.sort((a, b) => b.val - a.val);

  // Greedily merge: keep a peak only if no already-kept peak is within mergeRadius
  const r2 = mergeRadius * mergeRadius;
  const kept: Array<{ x: number; y: number }> = [];

  for (const p of raw) {
    let tooClose = false;
    for (const k of kept) {
      const dx = p.x - k.x,
        dy = p.y - k.y;
      if (dx * dx + dy * dy < r2) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) kept.push({ x: p.x, y: p.y });
  }

  return kept;
}

/** Compute fractional lattice offset for a point, given basis vectors and canvas center. */
function fractionalOffset(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  det: number,
  cx: number,
  cy: number,
): { du: number; dv: number } {
  const rx = px - cx,
    ry = py - cy;
  const u = (by * rx - bx * ry) / det;
  const v = (-ay * rx + ax * ry) / det;
  return { du: u - Math.round(u), dv: v - Math.round(v) };
}

/** Pixel-space residual of a point from its nearest lattice node. */
function latticeResidual2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  det: number,
  cx: number,
  cy: number,
): number {
  const { du, dv } = fractionalOffset(px, py, ax, ay, bx, by, det, cx, cy);
  const ex = du * ax + dv * bx;
  const ey = du * ay + dv * by;
  return ex * ex + ey * ey;
}

/** Compute origin (tx,ty) from median fractional offset of a set of points. */
function medianOrigin(
  pts: Array<{ x: number; y: number }>,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  det: number,
  cx: number,
  cy: number,
): { tx: number; ty: number } {
  const fracU: number[] = [];
  const fracV: number[] = [];
  for (const p of pts) {
    const { du, dv } = fractionalOffset(p.x, p.y, ax, ay, bx, by, det, cx, cy);
    fracU.push(du);
    fracV.push(dv);
  }
  fracU.sort((a, b) => a - b);
  fracV.sort((a, b) => a - b);
  const mu = fracU[Math.floor(fracU.length / 2)];
  const mv = fracV[Math.floor(fracV.length / 2)];
  return { tx: mu * ax + mv * bx, ty: mu * ay + mv * by };
}

/**
 * Fit a 2D lattice to detected points.
 * Collect nearest-neighbor vectors, bin by angle, pick two dominant bins ~90° apart.
 */
export function fitGrid(
  points: Array<{ x: number; y: number }>,
  canvasW: number,
  canvasH: number,
  basisAngle: number = Math.PI / 2,
): { a: number; alpha: number; b: number; beta: number; tx: number; ty: number } | null {
  if (points.length < 3) return null;

  const cx = canvasW / 2;
  const cy = canvasH / 2;

  // 1. For each point, find its nearest neighbor vector
  const nnVecs: Array<{ dx: number; dy: number; mag: number }> = [];
  for (let i = 0; i < points.length; i++) {
    let bestDist = Infinity;
    let bestDx = 0,
      bestDy = 0;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        bestDx = dx;
        bestDy = dy;
      }
    }
    nnVecs.push({ dx: bestDx, dy: bestDy, mag: Math.sqrt(bestDist) });
  }
  // 2. Normalize angles to [0, π) — treat opposite directions as same
  const anglesAndMags = nnVecs.map((v) => {
    let ang = Math.atan2(v.dy, v.dx);
    if (ang < 0) ang += Math.PI;
    return { ang, mag: v.mag };
  });

  // 3. Bin angles into 36 bins of 5° each over [0, π)
  const NUM_BINS = 36;
  const BIN_WIDTH = Math.PI / NUM_BINS;
  const bins: Array<{ sumAng: number; sumMag: number; count: number }> = [];
  for (let i = 0; i < NUM_BINS; i++) bins.push({ sumAng: 0, sumMag: 0, count: 0 });

  const binEntries: Array<Array<{ ang: number; mag: number }>> = [];
  for (let i = 0; i < NUM_BINS; i++) binEntries.push([]);

  for (const { ang, mag } of anglesAndMags) {
    const bin = Math.min(Math.floor(ang / BIN_WIDTH), NUM_BINS - 1);
    binEntries[bin].push({ ang, mag });
  }

  function median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // 4. Find the most populated bin → direction a
  let bestBinIdx = 0;
  for (let i = 1; i < NUM_BINS; i++) {
    if (binEntries[i].length > binEntries[bestBinIdx].length) bestBinIdx = i;
  }

  if (binEntries[bestBinIdx].length === 0) return null;

  const alphaA = median(binEntries[bestBinIdx].map((e) => e.ang));
  const magA = median(binEntries[bestBinIdx].map((e) => e.mag));

  // 5. Find best bin at basisAngle from a (within ±15°)
  const targetBin = Math.round(((alphaA + basisAngle) % Math.PI) / BIN_WIDTH) % NUM_BINS;
  const SEARCH_RANGE = 3; // ±15°
  let bestBBinIdx = -1;
  let bestBCount = 0;
  for (let offset = -SEARCH_RANGE; offset <= SEARCH_RANGE; offset++) {
    const idx = (((targetBin + offset) % NUM_BINS) + NUM_BINS) % NUM_BINS;
    if (binEntries[idx].length > bestBCount) {
      bestBCount = binEntries[idx].length;
      bestBBinIdx = idx;
    }
  }

  if (bestBBinIdx < 0 || bestBCount === 0 || bestBCount < binEntries[bestBinIdx].length * 0.2)
    return null;

  const magB = median(binEntries[bestBBinIdx].map((e) => e.mag));

  // a = b: average the two magnitudes
  const mag = (magA + magB) / 2;
  let a = mag;
  let alpha = alphaA;

  // Convert to basis vectors
  const ax = mag * Math.cos(alphaA),
    ay = mag * Math.sin(alphaA);
  const bx = mag * Math.cos(alphaA + basisAngle),
    by = mag * Math.sin(alphaA + basisAngle);
  const det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-9) return null;

  // 6. Estimate origin
  let { tx, ty } = medianOrigin(points, ax, ay, bx, by, det, cx, cy);

  // 7. Drop top 5% outliers upfront
  function computeMSE(
    pts: Array<{ x: number; y: number }>,
    a: number,
    alpha: number,
    tx: number,
    ty: number,
  ): number {
    const ax = a * Math.cos(alpha),
      ay = a * Math.sin(alpha);
    const bx = a * Math.cos(alpha + basisAngle),
      by = a * Math.sin(alpha + basisAngle);
    const det = ax * by - bx * ay;
    if (Math.abs(det) < 1e-9) return Infinity;
    let sum = 0;
    for (const p of pts) {
      sum += latticeResidual2(p.x - tx, p.y - ty, ax, ay, bx, by, det, cx, cy);
    }
    return sum / pts.length;
  }

  const withRes = points.map((p) => ({
    p,
    r: latticeResidual2(p.x - tx, p.y - ty, ax, ay, bx, by, det, cx, cy),
  }));
  withRes.sort((a, b) => a.r - b.r);
  const inliers = withRes.slice(0, Math.ceil(points.length * 0.95)).map((v) => v.p);

  // 8. Gradient descent on inliers — params: [a, alpha, tx, ty], b=a
  const init = [a, alpha, tx, ty];
  const clampRange = [a * 0.1, (5 * Math.PI) / 180, 10, 10];
  const MAX_ITERS = 50;
  const fd = [0.1, 0.0005, 0.1, 0.1];
  let params = [a, alpha, tx, ty];

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const mse = computeMSE(inliers, ...(params as [number, number, number, number]));

    const grad = [0, 0, 0, 0];
    for (let d = 0; d < 4; d++) {
      const p1 = [...params];
      p1[d] += fd[d];
      const p2 = [...params];
      p2[d] -= fd[d];
      grad[d] =
        (computeMSE(inliers, ...(p1 as [number, number, number, number])) -
          computeMSE(inliers, ...(p2 as [number, number, number, number]))) /
        (2 * fd[d]);
    }

    // Line search with halving
    let improved = false;
    let step = 4.0;
    for (let s = 0; s < 15; s++) {
      const candidate = params.map((v, i) => v - step * grad[i]);
      // Clamp each param to its allowed range from initial
      let clamped = false;
      for (let i = 0; i < 4; i++) {
        if (Math.abs(candidate[i] - init[i]) > clampRange[i]) {
          clamped = true;
          break;
        }
      }
      if (clamped) {
        step *= 0.5;
        continue;
      }
      const candidateMSE = computeMSE(inliers, ...(candidate as [number, number, number, number]));
      if (candidateMSE < mse) {
        params = candidate;
        improved = true;
        break;
      }
      step *= 0.5;
    }
    if (!improved) break;
  }

  [a, alpha, tx, ty] = params;
  const beta = alpha + basisAngle;

  return {
    a,
    alpha: normalizeAngleRad(alpha),
    b: a,
    beta: normalizeAngleRad(beta),
    tx,
    ty,
  };
}

/**
 * Detect grid point candidates from a phase contrast image.
 * Accepts normalized or unnormalized; min-max stretch preserves relative structure.
 */
export function detectGridPoints(
  image: HTMLImageElement | HTMLCanvasElement,
  radius: number = 5,
): Array<{ x: number; y: number }> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, image.width, image.height);

  const w = image.width;
  const h = image.height;

  // 1. Grayscale
  const gray = toGrayscale(imageData);
  // 2. Local variance
  const variance = localVariance(gray, w, h, radius);

  // 3. Log-variance → Otsu threshold → binary buffer
  const logVar = new Float32Array(w * h);
  for (let i = 0; i < logVar.length; i++) {
    logVar[i] = Math.log1p(variance[i]);
  }
  const threshold = otsuThreshold(logVar);
  const binary = new Float64Array(w * h);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = logVar[i] >= threshold ? 1 : 0;
  }
  // 3b. Morphological open (remove noise specks) then close (fill gaps)
  const morphR = 2;
  let cleaned = morphOpen(binary, w, h, morphR);
  cleaned = morphClose(cleaned, w, h, morphR);
  // 3c. Fill interior holes
  cleaned = fillHoles(cleaned, w, h);
  // 4. Distance transform (in-place on cleaned → becomes DT values)
  distanceTransform(cleaned, w, h);

  // 5. Find peaks
  let maxDT = 0;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] > maxDT) maxDT = cleaned[i];
  }
  const minVal = Math.max(3, maxDT * 0.1);
  const rawPeaks = findPeaks(cleaned, w, h, minVal);

  // 6. Filter artifact peaks: sort by DT ascending, advance start until CV < 0.2 (max 30% dropped)
  const peaksWithDT = rawPeaks.map((p) => ({ ...p, dt: cleaned[p.y * w + p.x] }));
  peaksWithDT.sort((a, b) => a.dt - b.dt);
  const maxDrop = Math.floor(peaksWithDT.length * 0.3);
  let startIdx = 0;
  for (let i = 0; i < maxDrop && peaksWithDT.length - i > 3; i++) {
    const slice = peaksWithDT.slice(i);
    const mean = slice.reduce((s, p) => s + p.dt, 0) / slice.length;
    const variance = slice.reduce((s, p) => s + (p.dt - mean) ** 2, 0) / slice.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv < 0.2) break;
    startIdx = i + 1;
  }

  return peaksWithDT.slice(startIdx).map(({ x, y }) => ({ x, y }));
}

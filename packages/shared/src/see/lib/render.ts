import type { ContourPoint } from "./contours";

/**
 * Render a uint16 grayscale buffer to a canvas with contrast adjustment.
 */

export function renderUint16ToCanvas(
  canvas: HTMLCanvasElement,
  data: Uint16Array,
  width: number,
  height: number,
  contrastMin: number,
  contrastMax: number,
) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;

  const range = contrastMax - contrastMin || 1;
  // Only iterate over the spatial pixels (last W*H elements of the chunk)
  const spatialSize = width * height;
  const dataOffset = data.length - spatialSize;

  for (let i = 0; i < spatialSize; i++) {
    const normalized = (data[dataOffset + i] - contrastMin) / range;
    const v = Math.max(0, Math.min(255, Math.round(normalized * 255)));
    const offset = i * 4;
    pixels[offset] = v;
    pixels[offset + 1] = v;
    pixels[offset + 2] = v;
    pixels[offset + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Draw spot markers as cyan hollow circles on an already-rendered canvas.
 */
export function drawSpots(canvas: HTMLCanvasElement, spots: { y: number; x: number }[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx || spots.length === 0) return;
  ctx.strokeStyle = "cyan";
  ctx.lineWidth = 1;
  for (const { x, y } of spots) {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

/**
 * Draw mask contours on an already-rendered canvas. Each contour is stroked as a path.
 */
export function drawMaskContours(
  canvas: HTMLCanvasElement,
  contours: ContourPoint[][],
  color: string = "lime",
) {
  const ctx = canvas.getContext("2d");
  if (!ctx || contours.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const contour of contours) {
    if (contour.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i++) {
      ctx.lineTo(contour[i].x, contour[i].y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

/**
 * Compute auto-contrast bounds (2nd–98th percentile) from uint16 data.
 */
export function autoContrast(data: Uint16Array): [number, number] {
  const sorted = new Uint16Array(data).sort();
  const lo = Math.floor(sorted.length * 0.02);
  const hi = Math.floor(sorted.length * 0.98);
  return [sorted[lo], sorted[hi]];
}

/**
 * Normalize ImageData for display using min-max stretch on luminance.
 * Preserves color by scaling R,G,B proportionally so perceived brightness maps to full range.
 * Mutates data in place.
 */
export function normalizeImageDataForDisplay(data: ImageData): void {
  const { data: d, width, height } = data;
  const n = width * height;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }

  if (max <= min) return;

  const scale = 255 / (max - min);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    const newLum = (lum - min) * scale;
    const factor = lum > 0 ? newLum / lum : 0;
    d[j] = Math.min(255, d[j] * factor);
    d[j + 1] = Math.min(255, d[j + 1] * factor);
    d[j + 2] = Math.min(255, d[j + 2] * factor);
  }
}

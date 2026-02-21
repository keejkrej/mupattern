import type { PatternPixels, Transform } from "@mupattern/shared/register/types";

export function buildBBoxCsv(
  canvasSize: { width: number; height: number },
  patternPx: PatternPixels,
  transform: Transform,
): string {
  const w = canvasSize.width;
  const h = canvasSize.height;
  const { lattice, width: rectW, height: rectH } = patternPx;

  const vec1 = {
    x: lattice.a * Math.cos(lattice.alpha),
    y: lattice.a * Math.sin(lattice.alpha),
  };
  const vec2 = {
    x: lattice.b * Math.cos(lattice.beta),
    y: lattice.b * Math.sin(lattice.beta),
  };

  const cx = w / 2 + transform.tx;
  const cy = h / 2 + transform.ty;
  const halfW = rectW / 2;
  const halfH = rectH / 2;

  const minLen = Math.min(
    Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y),
    Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y),
  );
  const maxDim = Math.max(w, h) * 2;
  const maxRange = minLen > 0 ? Math.ceil(maxDim / minLen) + 2 : 20;

  const rows: string[] = ["crop,x,y,w,h"];
  let crop = 0;

  for (let i = -maxRange; i <= maxRange; i++) {
    for (let j = -maxRange; j <= maxRange; j++) {
      const px = cx + i * vec1.x + j * vec2.x;
      const py = cy + i * vec1.y + j * vec2.y;
      const bx = px - halfW;
      const by = py - halfH;

      if (bx >= 0 && by >= 0 && bx + rectW <= w && by + rectH <= h) {
        rows.push(
          `${crop},${Math.round(bx)},${Math.round(by)},${Math.round(rectW)},${Math.round(rectH)}`,
        );
        crop++;
      }
    }
  }

  return rows.join("\n");
}

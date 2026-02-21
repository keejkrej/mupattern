import { useRef, useEffect, useCallback } from "react";

interface HexBackgroundProps {
  theme: "dark" | "light";
}

export function HexBackground({ theme }: HexBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);

  const draw = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, w, h);

      // Hex lattice parameters
      const spacing = 48;
      const rectSize = 10;
      const rotation = time * 0.00004; // slow drift

      // Hex basis vectors (60 degrees apart)
      const cos0 = Math.cos(rotation);
      const sin0 = Math.sin(rotation);
      const angle2 = rotation + Math.PI / 3;
      const cos2 = Math.cos(angle2);
      const sin2 = Math.sin(angle2);

      const v1x = spacing * cos0;
      const v1y = spacing * sin0;
      const v2x = spacing * cos2;
      const v2y = spacing * sin2;

      // Pulse the rectangle size gently
      const pulse = 1 + 0.15 * Math.sin(time * 0.0008);
      const rw = rectSize * pulse;
      const rh = rectSize * pulse;

      const cx = w / 2;
      const cy = h / 2;
      const maxDim = Math.max(w, h) * 1.5;
      const minLen = spacing;
      const range = Math.ceil(maxDim / minLen) + 2;

      const baseC = theme === "dark" ? 255 : 0;

      // Ripple: radial wave expanding outward from center
      const rippleSpeed = 0.002;
      const rippleFreq = 0.012;

      for (let i = -range; i <= range; i++) {
        for (let j = -range; j <= range; j++) {
          const x = cx + i * v1x + j * v2x;
          const y = cy + i * v1y + j * v2y;
          if (x < -rw || x > w + rw || y < -rh || y > h + rh) continue;

          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const ripple = Math.sin(dist * rippleFreq - time * rippleSpeed);
          const alpha = 0.045 + 0.035 * ripple;

          ctx.fillStyle = `rgba(${baseC}, ${baseC}, ${baseC}, ${alpha})`;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rotation);
          ctx.fillRect(-rw / 2, -rh / 2, rw, rh);
          ctx.restore();
        }
      }

      animRef.current = requestAnimationFrame(draw);
    },
    [theme],
  );

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" aria-hidden />;
}

import { useEffect, useRef } from "react";
import { resolveColor } from "../lib/colors";

/**
 * Mirrored bar waveform from precomputed peaks. Two layers: a dim one, and a
 * bright one clipped to the playhead (its width is driven imperatively via
 * `progressRef` so playback never re-renders React).
 */
export function Waveform({
  peaks,
  color,
  height = 56,
  progressRef,
  dimmed = false,
  theme,
  normalize = false,
}: {
  peaks: number[];
  color: string;
  height?: number;
  progressRef?: React.RefObject<HTMLDivElement | null>;
  dimmed?: boolean;
  theme?: string;
  normalize?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const lit = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const draw = () => {
      const w = el.clientWidth;
      if (!w) return;
      const dpr = window.devicePixelRatio || 1;
      const c = resolveColor(color);
      const dim = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--wave-dim")) || 0.28;
      const max = normalize ? Math.max(0.05, ...peaks) : 1;
      for (const [cv, alpha] of [
        [base.current, dim],
        [lit.current, 1],
      ] as const) {
        if (!cv) continue;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(height * dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${height}px`;
        const g = cv.getContext("2d")!;
        g.scale(dpr, dpr);
        g.fillStyle = c;
        g.globalAlpha = alpha;
        const bar = 2;
        const gap = 1.5;
        const n = Math.floor(w / (bar + gap));
        const mid = height / 2;
        for (let i = 0; i < n; i++) {
          const a = Math.floor((i / n) * peaks.length);
          const b = Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length));
          let p = 0;
          for (let j = a; j < b && j < peaks.length; j++) p = Math.max(p, peaks[j]);
          // gentle curve so quiet parts stay visible
          const v = Math.min(1, Math.pow(p / max, 0.7));
          const h = Math.max(1.5, v * (height - 4));
          g.beginPath();
          g.roundRect(i * (bar + gap), mid - h / 2, bar, h, 1);
          g.fill();
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [peaks, color, height, theme, normalize]);

  return (
    <div ref={wrap} className="relative w-full transition-opacity duration-200" style={{ height, opacity: dimmed ? 0.35 : 1 }}>
      <canvas ref={base} className="absolute inset-0" aria-hidden />
      <div ref={progressRef} className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: progressRef ? "0%" : "100%" }}>
        <canvas ref={lit} className="absolute inset-y-0 left-0" aria-hidden />
      </div>
    </div>
  );
}

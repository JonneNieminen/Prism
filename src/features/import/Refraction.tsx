import { motion, useReducedMotion } from "motion/react";
import { stemColor } from "../../lib/colors";

/** A white waveform enters the prism and leaves as coloured lanes (flat style). */
export function Refraction({ stems, progress, active = true, height = 200 }: { stems: { id: string; color?: string | null }[]; progress: number; active?: boolean; height?: number }) {
  const reduce = useReducedMotion();
  const W = 760;
  const H = height;
  const cy = H / 2;
  const px = W * 0.4;
  const n = Math.max(1, stems.length);
  const spread = Math.min(30, (H - 40) / n);
  const lanes = stems.map((s, i) => ({ ...s, y: cy + (i - (n - 1) / 2) * spread }));
  const wave = Array.from({ length: 60 }, (_, i) => {
    const x = (i / 59) * (px - 48);
    const y = cy + Math.sin(i * 0.9) * (5 + 5 * Math.sin(i * 0.23)) * (i / 59);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const flow = active && !reduce;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} role="img" aria-label="Separating the song into stems">
      <path d={wave} stroke="var(--text)" strokeOpacity={0.75} strokeWidth={2} fill="none" strokeLinecap="round" />
      {flow && (
        <motion.path
          d={wave}
          stroke="var(--text)"
          strokeWidth={2.4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="8 72"
          animate={{ strokeDashoffset: [0, -80] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
        />
      )}
      {lanes.map((l, i) => {
        const c = stemColor(l.id, l.color);
        const d = `M${px + 28} ${cy} C ${px + 105} ${cy}, ${px + 115} ${l.y}, ${px + 190} ${l.y} L ${W - 10} ${l.y}`;
        return (
          <g key={l.id}>
            <path d={d} stroke={c} strokeOpacity={0.18} strokeWidth={2.2} fill="none" strokeLinecap="round" />
            <motion.path
              d={d}
              stroke={c}
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.max(0.02, progress) }}
              transition={{ type: "tween", ease: "easeOut", duration: 0.5, delay: i * 0.04 }}
            />
            {flow && progress > 0.02 && (
              <motion.path
                d={d}
                stroke={c}
                strokeWidth={2.8}
                fill="none"
                strokeLinecap="round"
                strokeDasharray="5 95"
                animate={{ strokeDashoffset: [0, -100] }}
                transition={{ duration: 1.3 + i * 0.12, repeat: Infinity, ease: "linear" }}
              />
            )}
          </g>
        );
      })}
      <path
        d={`M${px - 3} ${cy - 50} Q ${px} ${cy - 54} ${px + 3} ${cy - 50} L ${px + 45} ${cy + 30} Q ${px + 47} ${cy + 34} ${px + 42} ${cy + 34} L ${px - 42} ${cy + 34} Q ${px - 47} ${cy + 34} ${px - 45} ${cy + 30} Z`}
        fill="var(--accent)"
      />
    </svg>
  );
}

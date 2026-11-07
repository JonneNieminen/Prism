import { motion, useReducedMotion } from "motion/react";
import { stemColor } from "../../lib/colors";

/** The signature animation: a white waveform enters the prism and leaves as coloured lanes. */
export function Refraction({
  stems,
  progress,
  active = true,
  height = 220,
}: {
  stems: { id: string; color?: string | null }[];
  progress: number;
  active?: boolean;
  height?: number;
}) {
  const reduce = useReducedMotion();
  const W = 760;
  const H = height;
  const cy = H / 2;
  const px = W * 0.4;
  const n = Math.max(1, stems.length);
  const spread = Math.min(34, (H - 40) / n);
  const lanes = stems.map((s, i) => ({ ...s, y: cy + (i - (n - 1) / 2) * spread }));
  // A wavy input line (static path; motion comes from the dash flow).
  const wave = Array.from({ length: 60 }, (_, i) => {
    const x = (i / 59) * (px - 50);
    const y = cy + Math.sin(i * 0.9) * (6 + 6 * Math.sin(i * 0.23)) * (i / 59);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const flow = active && !reduce;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} role="img" aria-label="Separating the song into stems">
      <defs>
        <linearGradient id="rf-prism" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brand-from)" />
          <stop offset="1" stopColor="var(--brand-to)" />
        </linearGradient>
        <filter id="rf-glow" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <path d={wave} stroke="var(--text)" strokeOpacity={0.85} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      {flow && (
        <motion.path
          d={wave}
          stroke="var(--text)"
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="10 70"
          animate={{ strokeDashoffset: [0, -80] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
        />
      )}

      {lanes.map((l, i) => {
        const c = stemColor(l.id, l.color);
        const d = `M${px + 30} ${cy} C ${px + 110} ${cy}, ${px + 120} ${l.y}, ${px + 200} ${l.y} L ${W - 10} ${l.y}`;
        return (
          <g key={l.id}>
            <path d={d} stroke={c} strokeOpacity={0.14} strokeWidth={3} fill="none" strokeLinecap="round" />
            <motion.path
              d={d}
              stroke={c}
              strokeWidth={6}
              fill="none"
              strokeLinecap="round"
              filter="url(#rf-glow)"
              opacity={0.55}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.max(0.02, progress) }}
              transition={{ type: "spring", stiffness: 60, damping: 20, delay: i * 0.05 }}
            />
            <motion.path
              d={d}
              stroke={c}
              strokeWidth={2.6}
              fill="none"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.max(0.02, progress) }}
              transition={{ type: "spring", stiffness: 60, damping: 20, delay: i * 0.05 }}
            />
            {flow && progress > 0.02 && (
              <motion.path
                d={d}
                stroke={c}
                strokeWidth={3.2}
                fill="none"
                strokeLinecap="round"
                strokeDasharray="6 90"
                animate={{ strokeDashoffset: [0, -96] }}
                transition={{ duration: 1.2 + i * 0.13, repeat: Infinity, ease: "linear" }}
                style={{ opacity: Math.min(1, progress * 4) }}
              />
            )}
          </g>
        );
      })}

      <motion.g
        animate={flow ? { scale: [1, 1.03, 1] } : undefined}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: `${px}px ${cy}px` }}
      >
        <path
          d={`M${px} ${cy - 62} L${px + 56} ${cy + 40} L${px - 56} ${cy + 40} Z`}
          fill="url(#rf-prism)"
          opacity={0.18}
          filter="url(#rf-glow)"
        />
        <path
          d={`M${px} ${cy - 56} L${px + 50} ${cy + 36} L${px - 50} ${cy + 36} Z`}
          fill="url(#rf-prism)"
          fillOpacity={0.9}
          stroke="var(--text)"
          strokeOpacity={0.25}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        <path d={`M${px - 8} ${cy - 34} L${px - 30} ${cy + 22}`} stroke="white" strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
      </motion.g>
    </svg>
  );
}

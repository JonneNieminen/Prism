import { motion, useReducedMotion } from "motion/react";
import { stemColor } from "../lib/colors";

/**
 * The "working" spinner: one arc per stem in its own colour, slowly turning around a calm
 * core, with a thin accent arc counter-rotating inside. Flat, no glow. Holds still (arcs
 * only) when the user prefers reduced motion.
 */
export function StemSpinner({ stems, size = 96 }: { stems: { id: string; color?: string | null }[]; size?: number }) {
  const reduce = useReducedMotion();
  const n = Math.max(1, stems.length);
  const R = 38;
  const C = 2 * Math.PI * R;
  const gap = n === 1 ? 0 : 11;
  const len = C / n - gap;
  const r2 = 27;
  const c2 = 2 * Math.PI * r2;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Working" className="mx-auto block">
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--pressed)" strokeWidth="6" />
      <motion.g animate={reduce ? undefined : { rotate: 360 }} transition={{ repeat: Infinity, duration: 3.2, ease: "linear" }}>
        {stems.map((s, i) => (
          <circle
            key={s.id}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={stemColor(s.id, s.color)}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(1, len)} ${C}`}
            transform={`rotate(${(i * 360) / n - 90} 50 50)`}
          />
        ))}
      </motion.g>
      <circle cx="50" cy="50" r={r2} fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      <motion.g animate={reduce ? undefined : { rotate: -360 }} transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}>
        <circle cx="50" cy="50" r={r2} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${c2 * 0.22} ${c2}`} transform="rotate(-90 50 50)" />
      </motion.g>
      <motion.circle
        cx="50"
        cy="50"
        r="6"
        fill="var(--text)"
        animate={reduce ? undefined : { scale: [0.85, 1.15, 0.85], opacity: [0.7, 1, 0.7] }}
        transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
        style={{ transformOrigin: "50px 50px" }}
      />
    </svg>
  );
}

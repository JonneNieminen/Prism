import { motion, useReducedMotion } from "motion/react";
import { stemColor } from "../../lib/colors";

/**
 * The processing animation, drawn like the Prism mark ("Bend"): white light falls, bends and
 * fans out into one lane per stem. Lanes draw out with progress; light keeps flowing through.
 */
export function Refraction({
  stems,
  progress,
  active = true,
}: {
  stems: { id: string; color?: string | null }[];
  progress: number;
  active?: boolean;
}) {
  const reduce = useReducedMotion();
  const flow = active && !reduce;
  const n = Math.max(1, stems.length);
  const W = 760;
  const bx = 190; // beam x
  const top = 14;
  const bend = 74; // where the beam meets the lanes
  const gap = Math.min(22, 120 / n);
  const r0 = 22;
  const lanes = stems.map((s, i) => {
    const r = r0 + i * gap;
    const y = bend + r;
    return { ...s, r, y, d: `M${bx} ${bend}A${r} ${r} 0 0 0 ${bx + r} ${y}H${W - 24}` };
  });
  const H = bend + r0 + (n - 1) * gap + 22;
  const done = progress >= 0.999;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} role="img" aria-label="Separating the song into stems">
      {/* lanes, outer first so inner lanes sit on top where they peel off the beam */}
      {[...lanes].reverse().map((l) => {
        const i = lanes.indexOf(l);
        const c = stemColor(l.id, l.color);
        return (
          <g key={l.id}>
            <path d={l.d} fill="none" stroke={c} strokeOpacity={0.16} strokeWidth={7} strokeLinecap="round" />
            <motion.path
              d={l.d}
              fill="none"
              stroke={c}
              strokeWidth={7}
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: Math.max(0.015, progress) }}
              transition={{ type: "tween", ease: "easeOut", duration: 0.5, delay: i * 0.04 }}
            />
            {flow && progress > 0.03 && !done && (
              <motion.path
                d={l.d}
                fill="none"
                stroke="var(--text)"
                strokeOpacity={0.55}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray="3 120"
                animate={{ strokeDashoffset: [0, -123] }}
                transition={{ duration: 1.6 + i * 0.14, repeat: Infinity, ease: "linear" }}
              />
            )}
            <motion.circle
              cx={W - 24}
              cy={l.y}
              r={6}
              fill={c}
              initial={{ scale: 0, opacity: 0 }}
              animate={done ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22, delay: i * 0.05 }}
            />
          </g>
        );
      })}
      {/* the white beam */}
      <path d={`M${bx} ${top}V${bend - 8}`} stroke="var(--text)" strokeWidth={11} strokeLinecap="round" />
      {flow && (
        <motion.path
          d={`M${bx} ${top}V${bend - 8}`}
          stroke="var(--bg)"
          strokeOpacity={0.35}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray="4 22"
          animate={{ strokeDashoffset: [0, -26] }}
          transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
        />
      )}
    </svg>
  );
}

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { tr } from "../i18n";
import { stemColor } from "../lib/colors";

/**
 * The download animation, in the same language as the Prism mark: white light falls from the
 * source, bends, and lays down a waveform along one lane. Each bar lights up in a stem colour as
 * the track arrives; while there's nothing to measure yet (finding the track), a soft ripple runs
 * down the lane; when saving, the finished waveform pulses once through.
 */
export function TrackFlow({
  stage,
  fraction,
  source,
}: {
  stage: "fetch" | "download" | "save" | "done";
  /** 0..1 when the size is known, `null` when it isn't. */
  fraction: number | null;
  /** "YouTube", "SoundCloud"… shown beside the beam. */
  source: string;
}) {
  const reduce = useReducedMotion();
  const N = 48;
  const W = 760;
  const bx = 190; // beam x, same as the separating animation
  const bend = 54;
  const r = 22;
  const laneY = bend + r;
  const x0 = bx + r + 10;
  const x1 = W - 24;
  const step = (x1 - x0) / (N - 1);
  const palette = ["drums", "bass", "other", "vocals"].map((id) => stemColor(id));
  const heights = useMemo(
    () => Array.from({ length: N }, (_, i) => 12 + 34 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21 + 1)) + (i % 5) * 2),
    [],
  );
  const lit = stage === "done" || stage === "save" ? N : Math.round((fraction ?? 0) * N);
  const ripple = !reduce && (stage === "fetch" || (stage === "download" && fraction == null));
  const flow = !reduce && stage !== "done";
  const H = laneY + 34;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} role="img" aria-label={tr("Downloading from {source}", { source })}>
      {/* the waveform lane */}
      {heights.map((h, i) => {
        const on = i < lit;
        const color = palette[Math.min(3, Math.floor((i / N) * 4))];
        // Each bar grows and shrinks around the lane's centre line by animating its own height and
        // y (plain SVG attributes), not a CSS transform, so it behaves the same in every webview.
        const frames = (scales: number[], opacity: number | number[]) => ({
          height: scales.map((k) => h * k),
          y: scales.map((k) => laneY - (h * k) / 2),
          opacity,
        });
        const animate = on
          ? stage === "save"
            ? frames([1, 1.22, 1], 1)
            : frames([1], 1)
          : ripple
            ? frames([0.16, 0.42, 0.16], 0.35)
            : frames([0.16], 0.2);
        const transition = on
          ? stage === "save"
            ? { duration: 0.7, delay: i * 0.018, repeat: Infinity, repeatDelay: 0.7 }
            : { type: "spring" as const, stiffness: 420, damping: 22 }
          : ripple
            ? { duration: 1.5, delay: i * 0.05, repeat: Infinity, ease: "easeInOut" as const }
            : { duration: 0.2 };
        return (
          <motion.rect
            key={i}
            x={x0 + i * step - 2.5}
            width={5}
            rx={2.5}
            fill={color}
            initial={{ height: h * 0.16, y: laneY - (h * 0.16) / 2, opacity: 0.2 }}
            animate={animate}
            transition={transition}
          />
        );
      })}

      {/* packets of light travelling down the lane */}
      {flow &&
        [0, 1, 2].map((k) => (
          <motion.circle
            key={k}
            cy={laneY}
            r={2.6}
            fill="var(--text)"
            initial={{ cx: x0, opacity: 0 }}
            animate={{ cx: [x0, x1], opacity: [0, 0.85, 0.85, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "linear", delay: k * 0.8 }}
          />
        ))}

      {/* where the beam bends into the lane */}
      <path d={`M${bx} ${bend}A${r} ${r} 0 0 0 ${bx + r} ${laneY}H${x0 - 6}`} fill="none" stroke="var(--text)" strokeOpacity={0.5} strokeWidth={3} strokeLinecap="round" />

      {/* the white beam */}
      <path d={`M${bx} 14V${bend - 8}`} stroke="var(--text)" strokeWidth={11} strokeLinecap="round" opacity={stage === "done" ? 0.35 : 1} />
      {flow && (
        <motion.path
          d={`M${bx} 14V${bend - 8}`}
          stroke="var(--bg)"
          strokeOpacity={0.35}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray="4 22"
          animate={{ strokeDashoffset: [0, -26] }}
          transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
        />
      )}
      <text x={bx + 22} y={26} fontSize={12} fill="var(--muted)">
        {tr("from {source}", { source })}
      </text>
    </svg>
  );
}

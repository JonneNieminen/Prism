import { tr } from "../i18n";
import { stemColor } from "../lib/colors";

/**
 * The "working" spinner: one arc per stem in its own colour, turning around a calm core, with a
 * thin accent arc counter-rotating inside. Flat, no glow.
 *
 * Drawn with SVG's built-in animation (SMIL) rather than CSS or a JS animation library, so it
 * keeps turning in every webview and never depends on transform-origin quirks. A spinner is
 * essential feedback, so it keeps going even when the system asks for reduced motion.
 */
export function StemSpinner({ stems, size = 96 }: { stems: { id: string; color?: string | null }[]; size?: number }) {
  const n = Math.max(1, stems.length);
  const R = 38;
  const C = 2 * Math.PI * R;
  const gap = n === 1 ? 0 : 11;
  const len = C / n - gap;
  const r2 = 27;
  const c2 = 2 * Math.PI * r2;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={tr("Working")} className="mx-auto block">
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--pressed)" strokeWidth="6" />
      <g>
        <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="3.2s" repeatCount="indefinite" />
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
      </g>
      <circle cx="50" cy="50" r={r2} fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      <g>
        <animateTransform attributeName="transform" type="rotate" from="360 50 50" to="0 50 50" dur="1.8s" repeatCount="indefinite" />
        <circle cx="50" cy="50" r={r2} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${c2 * 0.22} ${c2}`} transform="rotate(-90 50 50)" />
      </g>
      <circle cx="50" cy="50" r="6" fill="var(--text)">
        <animate attributeName="r" values="5;7;5" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.7;1;0.7" dur="1.8s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

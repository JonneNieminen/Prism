/** Prism mark: one line in, stem-coloured lanes out. Flat, theme-aware. */
export function Logo({ size = 28 }: { size?: number }) {
  const lanes = ["vocals", "drums", "bass", "other"];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M2 17.5H11" stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" />
      {lanes.map((l, i) => (
        <path
          key={l}
          d={`M17 17.5 C 21 17.5, 22 ${11 + i * 4}, 25.5 ${11 + i * 4} H30`}
          stroke={`var(--stem-${l})`}
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      ))}
      <path d="M13.2 7.2a1.5 1.5 0 0 1 2.6 0l6 10.6a1.5 1.5 0 0 1-1.3 2.2H8.5a1.5 1.5 0 0 1-1.3-2.2z" fill="var(--accent)" />
    </svg>
  );
}

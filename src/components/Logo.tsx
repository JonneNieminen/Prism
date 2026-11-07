/** Prism mark ("Bend", see design/logo): white light falls, bends and fans out
 *  into three stem lanes. Theme-aware: the beam uses --text, lanes the stem tokens. */
export function Logo({ size = 28 }: { size?: number }) {
  const lane = (d: string, end: number, c: string) => (
    <>
      <path d={d} fill="none" stroke={c} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="49" cy={end} r="3" fill={c} />
    </>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      {lane("M15 33A18 18 0 0 0 33 51H49", 51, "var(--stem-bass)")}
      {lane("M15 33A12 12 0 0 0 27 45H49", 45, "var(--stem-drums)")}
      {lane("M15 33A6 6 0 0 0 21 39H49", 39, "var(--stem-vocals)")}
      <path d="M15 14V28" fill="none" stroke="var(--text)" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

/** Lockup: symbol + lowercase wordmark whose i-dot is the accent (as in Lumio's "lum·io"). */
export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="Prism">
      <Logo size={size} />
      <span aria-hidden className="font-display text-[17px] font-semibold tracking-[-0.02em]">
        pr
        <span className="relative inline-block leading-none">
          ı
          <span className="absolute top-[0.06em] left-1/2 h-[0.19em] w-[0.19em] -translate-x-1/2 rounded-full bg-accent" />
        </span>
        sm
      </span>
    </span>
  );
}

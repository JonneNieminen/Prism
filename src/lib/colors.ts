// Stem colors. Known instruments use theme tokens (so the light theme can deepen
// them); other stems use the manifest's color, else a generated palette with the
// same saturation/lightness as the tokens.
const KNOWN = new Set(["vocals", "drums", "bass", "guitar", "piano", "other"]);

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A CSS color expression for a stem (usable in style props and canvas via `resolveColor`). */
export function stemColor(id: string, manifestColor?: string | null): string {
  if (KNOWN.has(id)) return `var(--stem-${id})`;
  if (manifestColor) return manifestColor;
  // golden-angle hue walk seeded by the id, avoiding hues the tokens already use
  const hue = Math.round((hash(id) * 137.508) % 360);
  return `hsl(${hue} var(--stem-gen-s) var(--stem-gen-l))`;
}

const probe = typeof document !== "undefined" ? document.createElement("span") : null;
/** Resolve a CSS color expression to a concrete color for canvas drawing. */
export function resolveColor(expr: string): string {
  if (!probe) return expr;
  if (!probe.isConnected) {
    probe.style.display = "none";
    document.body.appendChild(probe);
  }
  probe.style.color = "";
  probe.style.color = expr;
  return getComputedStyle(probe).color || expr;
}

/** `color` at `alpha` as a CSS expression. */
export function withAlpha(color: string, alpha: number) {
  return `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

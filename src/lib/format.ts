import type { MusicInfo } from "../bindings";

export function formatTime(secs: number) {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatEta(secs: number | null | undefined) {
  if (secs == null || !Number.isFinite(secs)) return "Estimating…";
  if (secs < 5) return "Almost done";
  if (secs < 60) return `About ${Math.ceil(secs / 5) * 5} s left`;
  const m = Math.round(secs / 60);
  return `About ${m} min left`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function formatDate(ms: number) {
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000 && d.getDate() === new Date().getDate()) return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export const QUALITY_LABEL = { fast: "Fast", balanced: "Balanced", best: "Best" } as const;

/** "128 BPM", rounded to a whole number. */
export function formatBpm(bpm: number) {
  return `${Math.round(bpm)} BPM`;
}

/** Key and tempo as one short line for lists, e.g. "A♭ major · 128 BPM". Empty when unknown. */
export function formatMusic(music: MusicInfo | null | undefined) {
  if (!music) return "";
  return [music.key?.name, music.bpm != null ? formatBpm(music.bpm) : null].filter(Boolean).join(" · ");
}

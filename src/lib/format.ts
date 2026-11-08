import type { MusicInfo, Quality } from "../bindings";
import { getLanguage, LOCALE, mark, tr } from "../i18n";

export function formatTime(secs: number) {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatEta(secs: number | null | undefined) {
  if (secs == null || !Number.isFinite(secs)) return tr("Estimating…");
  if (secs < 5) return tr("Almost done");
  if (secs < 60) return tr("About {n} s left", { n: Math.ceil(secs / 5) * 5 });
  return tr("About {n} min left", { n: Math.round(secs / 60) });
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
  const locale = LOCALE[getLanguage()];
  if (diff < 60_000) return tr("Just now");
  if (diff < 3_600_000) return tr("{n} min ago", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000 && d.getDate() === new Date().getDate()) return tr("Today, {time}", { time: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** "Fast", "Balanced" or "Best", in the current language. */
export function qualityLabel(q: Quality) {
  return q === "fast" ? tr("Fast") : q === "balanced" ? tr("Balanced") : tr("Best");
}

const MODES: string[] = [mark("major"), mark("minor")];

/** "A♭ major" with the mode word in the current language (the engine reports it in English). */
export function formatKeyName(name: string) {
  return name.replace(/ (major|minor)$/, (_, mode: string) => ` ${tr(MODES[mode === "major" ? 0 : 1])}`);
}

/** "128 BPM", rounded to a whole number. */
export function formatBpm(bpm: number) {
  return tr("{n} BPM", { n: Math.round(bpm) });
}

/** Key and tempo as one short line for lists, e.g. "A♭ major · 128 BPM". Empty when unknown. */
export function formatMusic(music: MusicInfo | null | undefined) {
  if (!music) return "";
  return [music.key ? formatKeyName(music.key.name) : null, music.bpm != null ? formatBpm(music.bpm) : null].filter(Boolean).join(" · ");
}

const STEM_NAMES: string[] = [mark("Drums"), mark("Bass"), mark("Other"), mark("Vocals"), mark("Guitar"), mark("Piano")];

/** A stem's name in the current language; names a model defines itself stay as written. */
export function stemLabel(label: string) {
  return STEM_NAMES.includes(label) ? tr(label) : label;
}

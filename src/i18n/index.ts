// Translations. The English text lives in the code, wrapped in a call to t; Finnish and Swedish
// are dictionaries keyed by that English text (src/i18n/fi.ts, sv.ts). Anything missing falls
// back to English, and a test scans the source so no string can be forgotten.
//
//   t('Open a song')                          plain text (double quotes in real code)
//   t('{n} of {total}', { n: 2, total: 4 })   with values
//   tn('{n} song', '{n} songs', count)        plurals (dictionary value: singular||plural)
//   mark('Separate')                          marks a string in a table; translate it where shown
//
// Rich text uses **bold**, `code` and {key:mod+O} keycaps; render it with the Rich component.
import type { Language } from "../bindings";
import { fi } from "./fi";
import { sv } from "./sv";

export type Vars = Record<string, string | number>;

const DICTS: Record<Language, Record<string, string>> = { en: {}, fi, sv };

/** Language names, each written in its own language. */
export const LANGUAGES: { id: Language; name: string }[] = [
  { id: "en", name: "English" },
  { id: "fi", name: "Suomi" },
  { id: "sv", name: "Svenska" },
];

/** For dates and numbers. */
export const LOCALE: Record<Language, string> = { en: "en", fi: "fi-FI", sv: "sv-SE" };

let current: Language = "en";
export const getLanguage = () => current;
export function setLanguage(lang: Language) {
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

export function translate(lang: Language, text: string, vars?: Vars) {
  return fill(DICTS[lang][text] ?? text, vars);
}

export function translateN(lang: Language, one: string, other: string, n: number, vars?: Vars) {
  const entry = DICTS[lang][one];
  const [singular, plural] = entry ? entry.split("||") : [one, other];
  return fill(n === 1 ? singular : (plural ?? singular), { n, ...vars });
}

/** Translate into the current language, for code outside React (toasts, formatters). */
export const tr = (text: string, vars?: Vars) => translate(current, text, vars);
export const trn = (one: string, other: string, n: number, vars?: Vars) => translateN(current, one, other, n, vars);

/** Marks a string for translation without translating it yet (labels in tables). */
export const mark = <T extends string>(text: T): T => text;

// Status lines the Rust side sends while it works (step details and the first-run note). They are
// fixed English patterns with {values}; each is matched and shown in the chosen language. The
// technical log lines stay in English on purpose, and so do the engine's error messages.
const BACKEND: string[] = [
  mark("Waiting for the cancelled separation"),
  mark("Reading “{file}”"),
  mark("Preparing the audio for the model"),
  mark("Detecting key and tempo"),
  mark("Optimizing the model"),
  mark("Loading the model"),
  mark("Optimizing model {i} of {n} · {stem}"),
  mark("Loading model {i} of {n} · {stem}"),
  mark("Optimizing model {i} of {n}"),
  mark("Loading model {i} of {n}"),
  mark("Model ready"),
  mark("Splitting the song into {n} stems"),
  mark("Writing {n} stems to your library"),
  mark("Retrying on the CPU"),
  mark("First run with this model: Prism is optimizing it for your Mac. This is a one-time wait — next time it loads in seconds."),
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPILED = BACKEND.map((key) => {
  const names: string[] = [];
  const source = key
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return escape(part);
      names.push(m[1]);
      return "(.+?)";
    })
    .join("");
  return { key, names, re: new RegExp(`^${source}$`) };
});

/** Translate a status line from the engine; anything unrecognised is shown as it came. */
export function translateBackend(lang: Language, text: string) {
  if (lang === "en") return text;
  for (const { key, names, re } of COMPILED) {
    const m = re.exec(text);
    if (m) return translate(lang, key, Object.fromEntries(names.map((n, i) => [n, n === "stem" ? translate(lang, m[i + 1]) : m[i + 1]])));
  }
  return text;
}

export const trb = (text: string) => translateBackend(current, text);

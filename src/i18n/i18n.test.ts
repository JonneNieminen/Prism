// Keeps the translations honest: every string the code asks for exists in Finnish and Swedish,
// nothing stale is left behind, and placeholders survive translation.
import { describe, expect, it } from "vitest";
import { fi } from "./fi";
import { sv } from "./sv";
import { translate, translateN } from "./index";

const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx", "!../bindings/**", "!./fi.ts", "!./sv.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const single = new RegExp(String.raw`(?<![\w.$])(?:t|tr|mark)\(\s*` + STR, "g");
const plural = new RegExp(String.raw`(?<![\w.$])(?:tn|trn)\(\s*` + STR + String.raw`\s*,\s*` + STR, "g");

/** Every translatable string in the code: key -> true when it is a plural (singular text). */
const used = new Map<string, boolean>();
for (const text of Object.values(sources)) {
  for (const m of text.matchAll(plural)) used.set(JSON.parse(`"${m[1]}"`), true);
  for (const m of text.matchAll(single)) {
    const key = JSON.parse(`"${m[1]}"`) as string;
    if (!used.has(key)) used.set(key, false);
  }
}
// Strings that are looked up by value, not written out where they are shown.
for (const k of ["major", "minor"]) used.set(k, false);

const placeholders = (s: string) => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();
const DICTS = { Finnish: fi, Swedish: sv };

describe("translations", () => {
  it("finds the strings the code asks for", () => {
    expect(used.size).toBeGreaterThan(400);
  });

  describe.each(Object.entries(DICTS))("%s", (_name, dict) => {
    it("has every string", () => {
      const missing = [...used.keys()].filter((k) => !(k in dict));
      expect(missing, `missing:\n${missing.join("\n")}`).toEqual([]);
    });

    it("has nothing the code no longer uses", () => {
      const stale = Object.keys(dict).filter((k) => !used.has(k));
      expect(stale, `stale:\n${stale.join("\n")}`).toEqual([]);
    });

    it("keeps the {placeholders}, bold and keycap tokens", () => {
      for (const [key, value] of Object.entries(dict)) {
        const parts = used.get(key) ? value.split("||") : [value];
        if (used.get(key)) expect(parts.length, `plural needs "singular||plural": ${key}`).toBe(2);
        for (const part of parts) {
          const want = placeholders(key).filter((p) => p !== "{n}" || !used.get(key));
          const got = placeholders(part).filter((p) => p !== "{n}" || !used.get(key));
          expect(got, key).toEqual(want);
          expect((part.match(/\*\*/g) ?? []).length, `bold markers: ${key}`).toBe((key.match(/\*\*/g) ?? []).length);
        }
        expect(value.trim(), key).not.toBe("");
      }
    });
  });
});

describe("translate", () => {
  it("falls back to English and fills values", () => {
    expect(translate("en", "Open {title}", { title: "X" })).toBe("Open X");
    expect(translate("fi", "Never")).toBe("Ei koskaan");
    expect(translate("sv", "Never")).toBe("Aldrig");
    expect(translate("fi", "Something not in the dictionary")).toBe("Something not in the dictionary");
  });
  it("picks singular or plural", () => {
    expect(translateN("en", "{n} min ago", "{n} mins ago", 1)).toBe("1 min ago");
    expect(translateN("en", "{n} min ago", "{n} mins ago", 3)).toBe("3 mins ago");
    expect(translateN("fi", "Songs are deleted after {n} day.", "Songs are deleted after {n} days.", 7)).toBe("Kappaleet poistetaan 7 päivän kuluttua.");
    expect(translateN("sv", "Songs are deleted after {n} day.", "Songs are deleted after {n} days.", 1)).toBe("Låtar tas bort efter 1 dag.");
    expect(translateN("sv", "Songs are deleted after {n} day.", "Songs are deleted after {n} days.", 7)).toBe("Låtar tas bort efter 7 dagar.");
  });
});

// Proves every shortcut on every platform: the keys listed in the table really trigger the
// command, the native menu and the README say the same thing, and the wrong modifier does nothing.
import menu from "../../src-tauri/src/menu.rs?raw";
import readme from "../../README.md?raw";
import { describe, expect, it, vi } from "vitest";

type P = "mac" | "windows" | "linux";
type Mods = { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean };

async function load(p: P) {
  vi.resetModules();
  vi.doMock("./platform", () => ({ platform: p, isMac: p === "mac", detectPlatform: () => p, thisComputer: "this computer", showInFileManager: "Show" }));
  return import("./shortcuts");
}

const NAMED: Record<string, [string, string]> = {
  ".": [".", "Period"],
  ",": [",", "Comma"],
  "/": ["/", "Slash"],
  "↩": ["Enter", "Enter"],
  "↑": ["ArrowUp", "ArrowUp"],
  "↓": ["ArrowDown", "ArrowDown"],
  "←": ["ArrowLeft", "ArrowLeft"],
  "→": ["ArrowRight", "ArrowRight"],
  space: [" ", "Space"],
  F11: ["F11", "F11"],
  F4: ["F4", "F4"],
};

/** The key event a user's keyboard would produce for a shortcut's keys. */
function eventFor(keys: string[], p: P) {
  const e = { key: "", code: "", shiftKey: false, altKey: false, metaKey: false, ctrlKey: false } as Mods & { key: string; code: string };
  for (const k of keys) {
    if (k === "mod") (p === "mac" ? (e.metaKey = true) : (e.ctrlKey = true));
    else if (k === "ctrl") e.ctrlKey = true;
    else if (k === "shift") e.shiftKey = true;
    else if (k === "alt") e.altKey = true;
    else if (NAMED[k]) [e.key, e.code] = NAMED[k];
    else if (/^[0-9]$/.test(k)) [e.key, e.code] = [k, `Digit${k}`];
    else [e.key, e.code] = [k.toLowerCase(), `Key${k.toUpperCase()}`];
  }
  return e as unknown as KeyboardEvent;
}

const PLATFORMS: P[] = ["mac", "windows", "linux"];

describe.each(PLATFORMS)("shortcuts on %s", (p) => {
  it("every page-level shortcut triggers its command", async () => {
    const { SHORTCUTS, matchEvent } = await load(p);
    let checked = 0;
    for (const s of SHORTCUTS) {
      if (s.systemOnly || s.id === "closeDialog" || s.keys.includes("–")) continue; // OS or dialog handles these
      const hit = matchEvent(eventFor(s.keys, p));
      expect(hit, `${s.keys.join("+")} should run ${s.id}`).toEqual({ id: s.id });
      checked++;
    }
    expect(checked).toBeGreaterThan(25);
  });

  it("stems 1–9 mute and Shift+1–9 solo", async () => {
    const { matchEvent } = await load(p);
    for (let n = 1; n <= 9; n++) {
      expect(matchEvent(eventFor([String(n)], p))).toEqual({ id: "muteStem", index: n - 1 });
      expect(matchEvent(eventFor(["shift", String(n)], p))).toEqual({ id: "soloStem", index: n - 1 });
    }
  });

  it("ignores the other platform's command key", async () => {
    const { matchEvent } = await load(p);
    const wrong = p === "mac" ? { ctrlKey: true } : { metaKey: true };
    expect(matchEvent({ ...eventFor(["O"], p), metaKey: false, ctrlKey: false, ...wrong } as unknown as KeyboardEvent)).toBeNull();
  });

  it("lists every command once, with nothing double-booked", async () => {
    const { SHORTCUTS } = await load(p);
    const combos = new Map<string, string>();
    for (const s of SHORTCUTS) {
      const c = [...s.keys].sort().join("+");
      expect(combos.get(c) ?? s.id, `${c} is used twice`).toBe(s.id);
      combos.set(c, s.id);
    }
  });
});

describe("window shortcuts", () => {
  it("Linux quits with Ctrl+Q through the page, Windows with Alt+F4 through the OS", async () => {
    const linux = await load("linux");
    expect(linux.matchEvent(eventFor(["mod", "Q"], "linux"))).toEqual({ id: "quit" });
    const win = await load("windows");
    expect(win.matchEvent(eventFor(["mod", "Q"], "windows"))).toBeNull();
    expect(win.SHORTCUTS.find((s) => s.id === "quit")?.keys).toEqual(["alt", "F4"]);
  });
  it("F11 is full screen on Windows and Linux only", async () => {
    for (const p of ["windows", "linux"] as P[]) expect((await load(p)).matchEvent(eventFor(["F11"], p))).toEqual({ id: "fullscreen" });
    expect((await load("mac")).matchEvent(eventFor(["F11"], "mac"))).toBeNull();
  });
});

// --- the native menu and the README must agree with the table -------------------------------
const MENU_KEYS: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Enter: "↩", Up: "↑", Down: "↓", Shift: "shift", Alt: "alt", CmdOrCtrl: "mod", Ctrl: "mod" };
const menuItems = [...menu.matchAll(/item\("([^"]+)",\s*"[^"]*",\s*Some\("([^"]+)"\)\)/g)].map(([, id, accel]) => ({
  id,
  keys: accel.split("+").map((k) => MENU_KEYS[k] ?? k.toUpperCase()),
}));

describe("native menu", () => {
  it("has accelerators, and every one matches the shortcut table", async () => {
    expect(menuItems.length).toBeGreaterThan(15);
    const seen = new Map<string, Set<string>>();
    for (const p of PLATFORMS) for (const s of (await load(p)).SHORTCUTS) (seen.get(s.id) ?? seen.set(s.id, new Set()).get(s.id)!).add([...s.keys].map((k) => k.toLowerCase()).sort().join("+"));
    for (const m of menuItems) {
      const want = [...m.keys].map((k) => k.toLowerCase()).sort().join("+");
      expect(seen.get(m.id)?.has(want), `menu item “${m.id}” is ${m.keys.join("+")} but the table says ${[...(seen.get(m.id) ?? [])].join(" or ")}`).toBe(true);
    }
  });

  it("offers every command-key shortcut", async () => {
    const inMenu = new Set(menuItems.map((m) => m.id));
    const { SHORTCUTS } = await load("mac");
    for (const s of SHORTCUTS.filter((x) => x.keys.includes("mod") && !x.systemOnly)) {
      expect(inMenu.has(s.id), `${s.id} (${s.keys.join("+")}) is missing from the native menu`).toBe(true);
    }
  });
});

describe("README shortcut tables", () => {
  it.each(["mac", "windows", "linux"] as P[])("lists the command-key shortcuts for %s", async (p) => {
    const { SHORTCUTS, formatKeys } = await load(p);
    for (const s of SHORTCUTS.filter((x) => x.keys.includes("mod") && !x.systemOnly)) {
      const text = formatKeys(s.keys);
      // The README writes macOS as ⌘ and Windows/Linux as Ctrl+; both share one table.
      expect(readme.includes(`**${text}**`), `README is missing ${text} (${s.label})`).toBe(true);
    }
  });
});

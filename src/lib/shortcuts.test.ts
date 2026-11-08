import { describe, expect, it } from "vitest";
import { matchEvent, SHORTCUTS } from "./shortcuts";

const key = (k: string, code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, code, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...mods }) as KeyboardEvent;

describe("matchEvent", () => {
  it("maps the loop keys", () => {
    expect(matchEvent(key("i", "KeyI"))).toEqual({ id: "loopIn" });
    expect(matchEvent(key("o", "KeyO"))).toEqual({ id: "loopOut" });
    expect(matchEvent(key("l", "KeyL"))).toEqual({ id: "loopToggle" });
  });

  it("maps number keys to stems and shift to solo", () => {
    expect(matchEvent(key("3", "Digit3"))).toEqual({ id: "muteStem", index: 2 });
    expect(matchEvent(key("#", "Digit3", { shiftKey: true }))).toEqual({ id: "soloStem", index: 2 });
    expect(matchEvent(key("0", "Digit0"))).toEqual({ id: "toStart" });
  });

  it("ignores plain letters with Alt held", () => {
    expect(matchEvent(key("l", "KeyL", { altKey: true }))).toBeNull();
  });
});

describe("shortcut table", () => {
  it("never gives two commands the same keys on one platform", () => {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) {
      const combo = [...s.keys].sort().join("+");
      const other = seen.get(combo);
      expect(other === undefined || other === s.id, `${combo}: ${other} and ${s.id}`).toBe(true);
      seen.set(combo, s.id);
    }
  });
});

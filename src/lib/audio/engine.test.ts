import { describe, expect, it } from "vitest";
import { effectiveGains, loopPosition } from "./engine";

describe("loopPosition", () => {
  const loop = { start: 10, end: 20 };

  it("plays straight through without a loop", () => {
    expect(loopPosition(25, null)).toBe(25);
  });

  it("plays into the loop from before it", () => {
    expect(loopPosition(4, loop)).toBe(4);
    expect(loopPosition(19.5, loop)).toBe(19.5);
  });

  it("wraps back to the loop start at its end, every time round", () => {
    expect(loopPosition(20, loop)).toBe(10);
    expect(loopPosition(23, loop)).toBe(13);
    expect(loopPosition(41, loop)).toBe(11);
  });
});

describe("effectiveGains", () => {
  it("lets solo win over mute, like a mixing desk", () => {
    const gains = effectiveGains([
      { id: "vocals", muted: true, solo: true, volume: 0.8 },
      { id: "drums", muted: false, solo: false, volume: 1 },
    ]);
    expect(gains).toEqual([
      { stemId: "vocals", gain: 0.8 },
      { stemId: "drums", gain: 0 },
    ]);
  });

  it("silences muted stems when nothing is soloed", () => {
    const gains = effectiveGains([
      { id: "vocals", muted: true, solo: false, volume: 1 },
      { id: "bass", muted: false, solo: false, volume: 1.2 },
    ]);
    expect(gains.map((g) => g.gain)).toEqual([0, 1.2]);
  });
});

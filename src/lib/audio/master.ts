// App-wide output level for playback, shared by every view. Lives outside React so the
// sidebar, the keyboard and the audio engine all see the same value. Remembered between launches.
import { create } from "zustand";

const KEY = "prism.master";

type Saved = { volume: number; muted: boolean };

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    const volume = typeof raw?.volume === "number" && Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 1;
    return { volume, muted: raw?.muted === true };
  } catch {
    return { volume: 1, muted: false };
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the level just isn't remembered */
  }
}

type MasterState = Saved & {
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  toggleMute(): void;
  /** Move the slider by `delta` (0–1 scale); un-mutes when raising. */
  nudge(delta: number): void;
};

export const STEP = 0.05;

/** Gain applied to the output. A squared taper makes the slider feel even to the ear. */
export function masterGain(volume: number, muted: boolean) {
  return muted ? 0 : volume * volume;
}

export const useMaster = create<MasterState>((set, get) => ({
  ...load(),
  setVolume(v) {
    const volume = Math.min(1, Math.max(0, v));
    set({ volume, muted: volume === 0 ? get().muted : false });
    save({ volume, muted: get().muted });
  },
  setMuted(muted) {
    set({ muted });
    save({ volume: get().volume, muted });
  },
  toggleMute() {
    get().setMuted(!get().muted);
  },
  nudge(delta) {
    const v = Math.round((get().volume + delta) * 100) / 100;
    get().setVolume(v);
    if (delta > 0) get().setMuted(false);
  },
}));

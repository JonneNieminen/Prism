import { create } from "zustand";
import { StemEngine, type StemMix } from "../../lib/audio/engine";
import { masterGain, useMaster } from "../../lib/audio/master";
import type { OpenProject } from "../../lib/ipc";

// Lives outside React so playback survives navigating between views.
type PlayerState = {
  projectId: string | null;
  engine: StemEngine | null;
  loading: number; // 0..1, 1 = ready
  error: string | null;
  playing: boolean;
  mix: StemMix[];
  load(p: OpenProject): void;
  unload(): void;
  setStem(id: string, patch: Partial<Omit<StemMix, "id">>): void;
  setAll(fn: (m: StemMix) => Partial<Omit<StemMix, "id">>): void;
  preset(kind: "karaoke" | "acapella" | "reset"): void;
  seekBy(secs: number): void;
};

export const usePlayer = create<PlayerState>((set, get) => ({
  projectId: null,
  engine: null,
  loading: 0,
  error: null,
  playing: false,
  mix: [],

  load(p) {
    if (get().projectId === p.project.id) return;
    get().engine?.dispose();
    const { volume, muted } = useMaster.getState();
    const engine = new StemEngine(masterGain(volume, muted));
    const mix = p.project.stems.map((s) => ({ id: s.id, muted: false, solo: false, volume: 1 }));
    set({ projectId: p.project.id, engine, loading: 0.02, error: null, playing: false, mix });
    engine.subscribe(() => set({ playing: engine.isPlaying }));
    engine
      .load(
        p.project.stems.map((s) => ({ id: s.id, url: p.stemUrls[s.id] })),
        (d, t) => get().engine === engine && set({ loading: Math.max(0.02, d / t) }),
      )
      .then(() => {
        if (get().engine !== engine) return;
        engine.setMix(get().mix);
        set({ loading: 1 });
      })
      .catch((e: unknown) => get().engine === engine && set({ error: e instanceof Error ? e.message : String(e) }));
  },

  unload() {
    get().engine?.dispose();
    set({ projectId: null, engine: null, loading: 0, playing: false, mix: [] });
  },

  setStem(id, patch) {
    const mix = get().mix.map((m) => (m.id === id ? { ...m, ...patch } : m));
    set({ mix });
    get().engine?.setMix(mix);
  },

  preset(kind) {
    const hasVocals = get().mix.some((m) => m.id === "vocals");
    if (kind === "reset") return get().setAll(() => ({ muted: false, solo: false, volume: 1 }));
    if (!hasVocals) return;
    if (kind === "karaoke") get().setAll((m) => ({ solo: false, muted: m.id === "vocals" }));
    else get().setAll((m) => ({ muted: false, solo: m.id === "vocals" }));
  },

  seekBy(secs) {
    const e = get().engine;
    if (e) e.seek(e.currentTime + secs);
  },

  setAll(fn) {
    const mix = get().mix.map((m) => ({ ...m, ...fn(m) }));
    set({ mix });
    get().engine?.setMix(mix);
  },
}));

// The master level follows the shared store, whichever view changed it.
useMaster.subscribe((m) => usePlayer.getState().engine?.setMasterGain(masterGain(m.volume, m.muted)));

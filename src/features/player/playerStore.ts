import { create } from "zustand";
import { MIN_LOOP, StemEngine, type LoopRegion, type StemMix } from "../../lib/audio/engine";
import { masterGain, useMaster } from "../../lib/audio/master";
import type { OpenProject } from "../../lib/ipc";

// Lives outside React so playback survives navigating between views.
// Each song's mix and loop are remembered (per project, in this browser profile), so
// reopening a song from the library sounds the way you left it.

type Saved = { mix: StemMix[]; loop: LoopRegion | null; loopOn: boolean };
const savedKey = (projectId: string) => `prism.player.${projectId}`;

function readSaved(projectId: string): Partial<Saved> {
  try {
    const raw = localStorage.getItem(savedKey(projectId));
    return raw ? (JSON.parse(raw) as Partial<Saved>) : {};
  } catch {
    return {};
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save(state: PlayerState) {
  const id = state.projectId;
  if (!id) return;
  clearTimeout(saveTimer);
  const data: Saved = { mix: state.mix, loop: state.loop, loopOn: state.loopOn };
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(savedKey(id), JSON.stringify(data));
    } catch {
      /* storage full or unavailable: the mix just isn't remembered */
    }
  }, 300);
}

/** Forget a song's remembered mix and loop, or every song's ("all"), when the library drops them. */
export function forgetPlayerState(projectId: string | "all") {
  try {
    if (projectId !== "all") return localStorage.removeItem(savedKey(projectId));
    const prefix = savedKey("");
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

type PlayerState = {
  projectId: string | null;
  engine: StemEngine | null;
  loading: number; // 0..1, 1 = ready
  error: string | null;
  playing: boolean;
  mix: StemMix[];
  /** Loop region (kept when looping is switched off, so L brings it back). */
  loop: LoopRegion | null;
  loopOn: boolean;
  /** Region being shift-dragged on a waveform; drawn live, applied on release. */
  loopDraft: LoopRegion | null;
  load(p: OpenProject): void;
  unload(): void;
  setStem(id: string, patch: Partial<Omit<StemMix, "id">>): void;
  setAll(fn: (m: StemMix) => Partial<Omit<StemMix, "id">>): void;
  preset(kind: "karaoke" | "acapella" | "reset"): void;
  seekBy(secs: number): void;
  setLoop(region: LoopRegion | null, on?: boolean): void;
  toggleLoop(): boolean;
  setLoopEdge(edge: "start" | "end"): void;
  setLoopDraft(region: LoopRegion | null): void;
};

export const usePlayer = create<PlayerState>((set, get) => ({
  projectId: null,
  engine: null,
  loading: 0,
  error: null,
  playing: false,
  mix: [],
  loop: null,
  loopOn: false,
  loopDraft: null,

  load(p) {
    if (get().projectId === p.project.id) return;
    get().engine?.dispose();
    const { volume, muted } = useMaster.getState();
    const engine = new StemEngine(masterGain(volume, muted));
    const saved = readSaved(p.project.id);
    const mix = p.project.stems.map((s) => {
      const m = saved.mix?.find((x) => x.id === s.id);
      return m ? { id: s.id, muted: !!m.muted, solo: !!m.solo, volume: Math.max(0, Math.min(1.5, Number(m.volume) || 0)) } : { id: s.id, muted: false, solo: false, volume: 1 };
    });
    const valid = (r: LoopRegion | null | undefined) =>
      r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.start >= 0 && r.end - r.start >= MIN_LOOP && r.end <= p.project.durationSecs + 1;
    const loop = valid(saved.loop) ? saved.loop! : null;
    const loopOn = !!loop && !!saved.loopOn;
    set({ projectId: p.project.id, engine, loading: 0.02, error: null, playing: false, mix, loop, loopOn, loopDraft: null });
    engine.subscribe(() => set({ playing: engine.isPlaying }));
    engine
      .load(
        p.project.stems.map((s) => ({ id: s.id, url: p.stemUrls[s.id] })),
        (d, t) => get().engine === engine && set({ loading: Math.max(0.02, d / t) }),
      )
      .then(() => {
        if (get().engine !== engine) return;
        engine.setMix(get().mix);
        const { loop, loopOn } = get();
        engine.setLoop(loopOn ? loop : null);
        set({ loading: 1 });
      })
      .catch((e: unknown) => get().engine === engine && set({ error: e instanceof Error ? e.message : String(e) }));
  },

  unload() {
    get().engine?.dispose();
    set({ projectId: null, engine: null, loading: 0, playing: false, mix: [], loop: null, loopOn: false, loopDraft: null });
  },

  setStem(id, patch) {
    const mix = get().mix.map((m) => (m.id === id ? { ...m, ...patch } : m));
    set({ mix });
    get().engine?.setMix(mix);
    save(get());
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
    save(get());
  },

  setLoop(region, on = true) {
    const loop = region && region.end - region.start >= MIN_LOOP ? region : null;
    const loopOn = !!loop && on;
    set({ loop, loopOn, loopDraft: null });
    get().engine?.setLoop(loopOn ? loop : null);
    save(get());
  },

  toggleLoop() {
    const { loop, loopOn } = get();
    if (!loop) return false;
    get().setLoop(loop, !loopOn);
    return true;
  },

  setLoopEdge(edge) {
    const e = get().engine;
    if (!e?.duration) return;
    const t = e.currentTime;
    const { loop } = get();
    if (edge === "start") {
      const end = loop && loop.end - t >= MIN_LOOP ? loop.end : e.duration;
      get().setLoop({ start: t, end });
    } else {
      const start = loop && t - loop.start >= MIN_LOOP ? loop.start : 0;
      get().setLoop({ start, end: t });
    }
  },

  setLoopDraft(region) {
    set({ loopDraft: region });
  },
}));

// The master level follows the shared store, whichever view changed it.
useMaster.subscribe((m) => usePlayer.getState().engine?.setMasterGain(masterGain(m.volume, m.muted)));

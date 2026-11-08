// Synchronised multi-stem playback with the Web Audio API. Every stem is an
// AudioBuffer started at the same AudioContext time, so they stay sample-locked.
// Mute/solo/volume only touch GainNodes (short ramps, no clicks), so changes are
// instant while playing.

export type StemMix = { id: string; muted: boolean; solo: boolean; volume: number };

export class StemEngine {
  private ctx = new AudioContext({ latencyHint: "interactive" });
  private master = this.ctx.createGain();
  private buffers = new Map<string, AudioBuffer>();
  private gains = new Map<string, GainNode>();
  private sources: AudioBufferSourceNode[] = [];
  private startedAt = 0; // ctx time when offset 0 would have played
  private offset = 0; // paused position in seconds
  private playing = false;
  private disposed = false;
  private listeners = new Set<() => void>();
  duration = 0;

  constructor(initialGain = 1) {
    this.master.gain.value = initialGain;
    this.master.connect(this.ctx.destination);
  }

  /** Output level for all stems (0–1), ramped so it never clicks. */
  setMasterGain(gain: number) {
    this.master.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.015);
  }

  /** Fetch + decode every stem (decoding runs off the main thread). */
  async load(stems: { id: string; url: string }[], onProgress?: (done: number, total: number) => void) {
    let done = 0;
    await Promise.all(
      stems.map(async ({ id, url }) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Couldn't load the “${id}” stem.`);
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        if (this.disposed) return;
        this.buffers.set(id, buf);
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.gains.set(id, g);
        this.duration = Math.max(this.duration, buf.duration);
        onProgress?.(++done, stems.length);
      }),
    );
  }

  get isPlaying() {
    return this.playing;
  }

  get currentTime() {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.ctx.currentTime - this.startedAt);
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  private notify() {
    this.listeners.forEach((l) => l());
  }

  async play() {
    if (this.playing || this.disposed || this.buffers.size === 0) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    const when = this.ctx.currentTime + 0.03;
    this.startedAt = when - this.offset;
    this.sources = [];
    for (const [id, buf] of this.buffers) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gains.get(id)!);
      src.start(when, this.offset);
      this.sources.push(src);
    }
    const first = this.sources[0];
    if (first) {
      first.onended = () => {
        if (this.playing && this.ctx.currentTime - this.startedAt >= this.duration - 0.05) {
          this.stopSources();
          this.playing = false;
          this.offset = 0;
          this.notify();
        }
      };
    }
    this.playing = true;
    this.notify();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.stopSources();
    this.playing = false;
    this.notify();
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  seek(t: number) {
    const was = this.playing;
    if (was) {
      this.stopSources();
      this.playing = false;
    }
    this.offset = Math.max(0, Math.min(this.duration, t));
    if (was) void this.play();
    else this.notify();
  }

  /**
   * Scrubbing: while the user drags, only move the playhead (no source restarts on
   * every pointer move); playback resumes from the final position on `endScrub`.
   */
  private scrubResume: boolean | null = null;
  beginScrub() {
    if (this.scrubResume !== null) return;
    this.scrubResume = this.playing;
    if (this.playing) {
      // Silent pause: no notify, so the play button doesn't flicker mid-drag.
      this.offset = this.currentTime;
      this.stopSources();
      this.playing = false;
    }
  }
  scrubTo(t: number) {
    if (this.scrubResume === null) return this.seek(t);
    this.offset = Math.max(0, Math.min(this.duration, t));
  }
  endScrub() {
    const resume = this.scrubResume;
    this.scrubResume = null;
    if (resume && this.offset < this.duration - 0.05) void this.play();
    else this.notify();
  }

  /** Apply mute / solo / volume. Solo wins over mute, like a mixing desk. */
  setMix(mix: StemMix[]) {
    const anySolo = mix.some((m) => m.solo);
    const now = this.ctx.currentTime;
    for (const m of mix) {
      const g = this.gains.get(m.id);
      if (!g) continue;
      const audible = anySolo ? m.solo : !m.muted;
      // Instant (5 ms ramp, just enough to avoid a click). Cancel anything still scheduled
      // so rapid toggles never queue up behind an earlier fade.
      const target = audible ? m.volume : 0;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(target, now + 0.005);
    }
  }

  private stopSources() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.sources = [];
  }

  dispose() {
    this.disposed = true;
    this.stopSources();
    this.listeners.clear();
    this.buffers.clear();
    void this.ctx.close();
  }
}

/** Effective gain for export (same rules as playback). */
export function effectiveGains(mix: StemMix[]) {
  const anySolo = mix.some((m) => m.solo);
  return mix.map((m) => ({ stemId: m.id, gain: (anySolo ? m.solo : !m.muted) ? m.volume : 0 }));
}

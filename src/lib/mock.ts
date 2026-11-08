// Browser-only stand-in for the Rust backend, so the UI can be developed and
// checked with `npm run dev` in a normal browser. Never used inside Tauri.
import type { CatalogEntry, ModelInfo, ModelManifest, Project, Settings } from "../bindings";
import type { Backend, DownloadEvent, JobEvent, OpenProject, TrackEvent, UpdateEvent } from "./ipc";

const demucs: ModelManifest = {
  schemaVersion: 1,
  id: "htdemucs",
  name: "Demucs v4 · 4 stems",
  version: "4.0.1",
  architecture: "demucs",
  weights: "htdemucs.onnx",
  sampleRate: 44100,
  channels: 2,
  stems: [
    { id: "drums", label: "Drums" },
    { id: "bass", label: "Bass" },
    { id: "other", label: "Other" },
    { id: "vocals", label: "Vocals" },
  ],
  chunkSeconds: 7.8,
  overlap: 0.25,
  license: "MIT",
  author: "Meta AI",
  description: "Hybrid Transformer Demucs. The balanced default: vocals, drums, bass and everything else.",
  hints: { speed: 3, quality: 4 },
  quality: { fast: { shifts: 0 }, balanced: { shifts: 1 }, best: { shifts: 3 } },
};

const sixStem: ModelManifest = {
  ...demucs,
  id: "htdemucs_6s",
  name: "Demucs v4 · 6 stems",
  stems: [
    { id: "drums", label: "Drums" },
    { id: "bass", label: "Bass" },
    { id: "other", label: "Other" },
    { id: "vocals", label: "Vocals" },
    { id: "guitar", label: "Guitar" },
    { id: "piano", label: "Piano" },
  ],
  description: "Adds guitar and piano stems. Piano separation is experimental.",
  hints: { speed: 3, quality: 3 },
};

let settings: Settings = {
  activeModelId: "htdemucs",
  quality: "balanced",
  exportFormat: "wav",
  mp3Bitrate: 320,
  defaultSaveDir: null,
  theme: "system",
  acceleration: "auto",
  catalogUrl: "https://raw.githubusercontent.com/JonneNieminen/Prism/main/catalog/index.json",
  hiddenModels: [],
  acceptedLicenses: [],
  libraryRetentionDays: 7,
  recentLayout: "tiles",
  trackDownloadDir: null,
  language: "en",
  updatesEnabled: true,
};

const projects: Project[] = [];
const listeners = {
  sep: new Set<(e: JobEvent) => void>(),
  dl: new Set<(e: DownloadEvent) => void>(),
  track: new Set<(e: TrackEvent) => void>(),
  update: new Set<(e: UpdateEvent) => void>(),
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const info = (m: ModelManifest, bundled: boolean): ModelInfo => ({
  manifest: m,
  bundled,
  sizeBytes: 174_264_722,
  nonCommercial: false,
  qualities: ["fast", "balanced", "best"],
  problem: null,
});

/** Song-like waveform overviews for the demo: sections, transients, vocal phrases. */
function demoPeaks(kind: number, n = 1200) {
  let seed = 1234 + kind * 97;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const section = (x: number) => (x < 0.08 ? 0.35 : x < 0.3 ? 0.7 : x < 0.5 ? 1 : x < 0.58 ? 0.45 : x < 0.88 ? 1 : 0.3);
  return Array.from({ length: n }, (_, i) => {
    const x = i / n;
    const env = section(x);
    let v: number;
    if (kind % 4 === 0) v = (i % 12 < 2 ? 0.95 : i % 6 < 1 ? 0.7 : 0.25) * env; // drums: hits
    else if (kind % 4 === 1) v = (0.55 + 0.15 * Math.sin(i / 7)) * env; // bass: steady
    else if (kind % 4 === 2) v = (0.4 + 0.25 * Math.sin(i / 23) ** 2) * env; // other: pads
    else v = (Math.sin(i / 9) > -0.3 && x > 0.08 && !(x > 0.5 && x < 0.58) ? 0.5 + 0.35 * Math.abs(Math.sin(i / 3.3)) : 0.04) * env; // vocals: phrases
    return Math.min(1, Math.max(0.02, v * (0.8 + 0.4 * rnd())));
  });
}

/** Tiny synthetic stems so the player can be exercised in a browser. */
function synthStem(kind: number, seconds = 24, sr = 22050): string {
  const n = seconds * sr;
  const data = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beat = t % 0.5;
    let v = 0;
    if (kind === 0) v = Math.exp(-beat * 18) * Math.sin(2 * Math.PI * 60 * beat) * 0.8 + (Math.random() - 0.5) * Math.exp(-((t + 0.25) % 0.5) * 40) * 0.4;
    if (kind === 1) v = Math.sin(2 * Math.PI * [55, 55, 73.4, 65.4][Math.floor(t) % 4] * t) * 0.45;
    if (kind === 2) v = [261.6, 329.6, 392].reduce((a, f) => a + Math.sin(2 * Math.PI * f * t) * 0.08, 0);
    if (kind === 3) v = Math.sin(2 * Math.PI * (440 + 40 * Math.sin(t * 5)) * t) * 0.25 * (Math.floor(t * 2) % 3 === 0 ? 0 : 1);
    const s = Math.max(-1, Math.min(1, v)) * 32767;
    data[i * 2] = s;
    data[i * 2 + 1] = s;
  }
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const w = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  dv.setUint32(4, 36 + data.byteLength, true);
  w(8, "WAVEfmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  w(36, "data");
  dv.setUint32(40, data.byteLength, true);
  return URL.createObjectURL(new Blob([header, data.buffer], { type: "audio/wav" }));
}

function demoProject(title: string, id: string = crypto.randomUUID()): Project {
  return {
    id,
    title,
    artist: "Demo Artist",
    sourceFileName: `${title}.mp3`,
    durationSecs: 24,
    sampleRate: 44100,
    createdAt: Date.now(),
    model: { id: "htdemucs", name: demucs.name, architecture: "demucs", version: "4.0.1", license: "MIT" },
    quality: settings.quality,
    device: "Apple Silicon (Core ML)",
    processingSecs: 6.2,
    stems: demucs.stems.map((s) => ({ id: s.id, label: s.label, color: null, file: `stems/${s.id}.wav` })),
    music: { bpm: 112, bpmConfidence: 0.74, key: { tonic: 9, minor: true, name: "A minor", camelot: "8A", confidence: 0.8 } },
  };
}

const urls = new Map<string, Record<string, string>>();

export function mockBackend(): Backend {
  if (projects.length === 0) projects.push({ ...demoProject("Midnight Drive", "demo-midnight-drive"), createdAt: Date.now() - 86_400_000 * 2 });
  return {
    appInfo: async () => ({
      version: "1.0.0-dev",
      dataDir: "~/Library/Application Support/com.jonnenieminen.prism",
      libraryBytes: 412_000_000,
      accelCacheBytes: 635_000_000,
      modelsBytes: 0,
      supportedExtensions: ["mp3", "wav", "flac", "m4a", "mp4", "ogg", "oga", "aac"],
    }),
    getSettings: async () => settings,
    setSettings: async (s) => (settings = s),
    analyzeTrack: async (path) => {
      await sleep(900);
      const name = path.split("/").pop() ?? path;
      return {
        info: { title: name.replace(/\.[^.]+$/, ""), artist: "Demo Artist", durationSecs: 214.3, sampleRate: 44100, channels: 2, fileName: name },
        peaks: demoPeaks(2).map((v, i) => Math.min(1, v + demoPeaks(0)[i] * 0.5)),
        music: { bpm: 122, bpmConfidence: 0.82, key: { tonic: 9, minor: true, name: "A minor", camelot: "8A", confidence: 0.64 } },
        secs: 1.4,
      };
    },
    probeAudio: async (path) => {
      await sleep(500);
      const name = path.split("/").pop() ?? path;
      if (name.endsWith(".txt"))
        throw { kind: "unsupportedFile", message: "“.txt” files aren't supported. Try MP3, WAV, FLAC, M4A or OGG." };
      return {
        info: { title: name.replace(/\.[^.]+$/, ""), artist: "Demo Artist", durationSecs: 214.3, sampleRate: 44100, channels: 2, fileName: name },
        peaks: demoPeaks(2).map((v, i) => Math.min(1, v + demoPeaks(0)[i] * 0.5)),
      };
    },
    startSeparation: async (path) => {
      const jobId = `sep-${crypto.randomUUID()}`;
      const title = (path.split("/").pop() ?? "Song").replace(/\.[^.]+$/, "");
      void (async () => {
        const emit = (e: JobEvent) => listeners.sep.forEach((l) => l(e));
        const step = (stage: "decoding" | "loading", fraction: number, detail: string, note: string | null = null) =>
          emit({ kind: "progress", jobId, stage, fraction, etaSecs: null, device: null, detail, note });
        const log = (text: string, level: "info" | "warn" = "info") => emit({ kind: "log", jobId, level, text });
        const name = path.split("/").pop();
        log("Model: Demucs v4 · demucs 4.0.1 · 4 networks · 4 stems (drums, bass, other, vocals)");
        step("decoding", 0, `Reading “${name}”`);
        log(`Opening “${name}” and decoding it to raw audio`);
        await sleep(500);
        log("Decoded 3:34 of audio · 44.1 kHz stereo · 9437184 samples per channel");
        step("decoding", 1, "Preparing the audio for the model");
        log("Already 44.1 kHz stereo: no conversion needed");
        await sleep(300);
        step("decoding", 1, "Detecting key and tempo");
        log("Analysing the whole track for tempo and musical key");
        await sleep(400);
        log("Tempo 122.0 BPM · key A minor (8A)");
        const note = "First run with this model: Prism is optimizing it for your Mac. This is a one-time wait — next time it loads in seconds.";
        log("No compiled copy found: Core ML will compile each network once and keep the result");
        for (const [i, stem] of ["Drums", "Bass", "Other", "Vocals"].entries()) {
          if (cancelled.has(jobId)) return emit({ kind: "error", jobId, error: { kind: "cancelled", message: "Cancelled" } });
          const what = `Model ${i + 1} of 4 (${stem.toLowerCase()})`;
          step("loading", i / 4, `Optimizing model ${i + 1} of 4 · ${stem}`, note);
          log(`${what}: reading the weights “htdemucs_ft_${stem.toLowerCase()}.onnx” (174 MB)`);
          log(`${what}: creating the inference session · ONNX Runtime · 10 threads · full graph optimization`);
          log(`${what}: handing the graph to Core ML (ML Program, GPU + Neural Engine allowed)`);
          await sleep(1100);
          log(`Still compiling ${what.toLowerCase()} · 0:0${i + 5} so far`);
          await sleep(900);
          log(`${what} ready in ${(2 + i * 0.7).toFixed(1)} s`);
        }
        step("loading", 1, "Model ready");
        log("Running on Apple Silicon (Core ML)");
        log("Quality “Balanced”: 1 random shift pass, 25% overlap between chunks");
        log("Cutting the track into chunks of 7.8 s and running each through the model");
        for (let i = 1; i <= 40; i++) {
          if (cancelled.has(jobId)) return emit({ kind: "error", jobId, error: { kind: "cancelled", message: "Cancelled" } });
          emit({ kind: "progress", jobId, stage: "separating", fraction: i / 40, etaSecs: (40 - i) * 0.15, device: "Apple Silicon (Core ML)", detail: "Splitting the song into 4 stems", note: null });
          log(`Chunk ${i} of 40 · ${Math.round((i / 40) * 100)}% · 0:0${Math.floor((i * 0.15) % 10)} elapsed · about 0:0${Math.floor(((40 - i) * 0.15) % 10)} left`);
          await sleep(150);
        }
        log("Separation finished in 0:08");
        log("Writing 4 stems as 32-bit WAV files and drawing their waveforms");
        log("Saved to the library");
        const p = demoProject(title);
        projects.unshift(p);
        emit({ kind: "done", jobId, project: p });
      })();
      return jobId;
    },
    cancelJob: async (id) => void cancelled.add(id),
    classifyLink: async (url) => {
      const u = url.trim();
      if (/spotify\.(com|link)|spoti\.fi/i.test(u))
        throw { kind: "other", message: "Spotify streams are copy-protected, so Prism can't download them. If you have the track as a file (MP3, WAV, FLAC…), drop it onto Separate instead." };
      if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(u)) throw { kind: "other", message: "That doesn't look like a web link. It should start with https://" };
      const platform = /(^|\.|\/\/)(youtube\.com|youtu\.be)/i.test(u)
        ? "youTube"
        : /soundcloud\.com|snd\.sc/i.test(u)
          ? "soundCloud"
          : /instagram\.com|instagr\.am/i.test(u)
            ? "instagram"
            : /tiktok\.com/i.test(u)
              ? "tikTok"
              : "other";
      return { url: u, platform };
    },
    trackDownloadDir: async () => settings.trackDownloadDir ?? "/Users/demo/Downloads/Prism",
    startTrackDownload: async (url) => {
      const jobId = `track-${crypto.randomUUID()}`;
      const link = await mockBackend().classifyLink(url);
      void (async () => {
        const emit = (e: TrackEvent) => listeners.track.forEach((l) => l(e));
        const base = { kind: "progress" as const, jobId, platform: link.platform, uploader: "Demo Artist", speed: null, etaSecs: null, doneBytes: null, totalBytes: null };
        emit({ ...base, stage: "fetch", title: null, uploader: null, fraction: null });
        await sleep(1400);
        const title = "Neon Skyline (Official Audio)";
        const total = 9_400_000;
        for (let i = 0; i <= 40; i++) {
          if (cancelled.has(jobId)) return emit({ kind: "error", jobId, error: { kind: "cancelled", message: "Cancelled" } });
          const f = i / 40;
          emit({ ...base, stage: "download", title, fraction: f, doneBytes: Math.round(total * f), totalBytes: total, speed: 2_300_000, etaSecs: (1 - f) * 4 });
          await sleep(110);
        }
        emit({ ...base, stage: "save", title, fraction: 1, doneBytes: total, totalBytes: total });
        await sleep(1000);
        emit({ kind: "done", jobId, path: "/Users/demo/Downloads/Prism/Neon Skyline (Official Audio) [x1].m4a", title, separable: true });
      })();
      return jobId;
    },
    onTrackDownload: async (cb) => (listeners.track.add(cb), () => void listeners.track.delete(cb)),
    listProjects: async () => [...projects],
    openProject: async (id): Promise<OpenProject> => {
      const project = projects.find((p) => p.id === id);
      if (!project) throw { kind: "other", message: "This project is no longer in the library." };
      if (!urls.has(id)) urls.set(id, Object.fromEntries(project.stems.map((s, i) => [s.id, synthStem(i)])));
      return {
        project,
        peaks: Object.fromEntries(project.stems.map((s, i) => [s.id, demoPeaks(i, 2000)])),
        stemUrls: urls.get(id)!,
      };
    },
    detectMusic: async (id) => projects.find((p) => p.id === id)!,
    renameProject: async (id, title) => {
      const p = projects.find((x) => x.id === id)!;
      p.title = title;
      return p;
    },
    deleteProject: async (id) => void projects.splice(projects.findIndex((p) => p.id === id), 1),
    clearCache: async (library) => void (library && projects.splice(0)),
    suggestFileName: async (title, suffix, ext) => `${title} - ${suffix}.${ext}`,
    exportStem: () => sleep(700),
    exportMix: () => sleep(900),
    exportZip: () => sleep(1500),
    listModels: async () => ({
      listing: {
        models: [info(demucs, true), ...installed.map((m) => info(m, false))],
        problems: [],
      },
      activeId: settings.activeModelId,
    }),
    importModel: async () => {
      throw { kind: "invalidModel", message: "Architecture “bs-roformer” isn't supported. Supported architectures: demucs, mdx-net." };
    },
    removeModel: async (id) => void installed.splice(installed.findIndex((m) => m.id === id), 1),
    fetchCatalog: async () => {
      await sleep(400);
      return { entries: [{ manifest: sixStem, files: [{ file: "htdemucs_6s.onnx", url: "https://example.invalid", bytes: 114_560_304 }] } satisfies CatalogEntry], warnings: [] };
    },
    installCatalogModel: async (jobId, entry) => {
      const emit = (e: DownloadEvent) => listeners.dl.forEach((l) => l(e));
      void (async () => {
        const total = entry.files.reduce((a, f) => a + f.bytes, 0);
        for (let i = 1; i <= 20; i++) {
          if (cancelled.has(jobId)) return emit({ kind: "error", jobId, error: { kind: "cancelled", message: "Cancelled" } });
          emit({ kind: "progress", jobId, done: (total * i) / 20, total });
          await sleep(120);
        }
        installed.push(entry.manifest);
        emit({ kind: "done", jobId, modelId: entry.manifest.id });
      })();
    },
    onSeparation: async (cb) => (listeners.sep.add(cb), () => void listeners.sep.delete(cb)),
    onDownload: async (cb) => (listeners.dl.add(cb), () => void listeners.dl.delete(cb)),
    onExportProgress: async () => () => {},
    onDragDrop: async (cb) => {
      const over = (e: DragEvent) => (e.preventDefault(), cb({ type: "over", paths: [] }));
      const leave = () => cb({ type: "leave", paths: [] });
      const drop = (e: DragEvent) => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        cb({ type: "drop", paths: f ? [`/Users/demo/Music/${f.name}`] : [] });
      };
      window.addEventListener("dragover", over);
      window.addEventListener("dragleave", leave);
      window.addEventListener("drop", drop);
      return () => {
        window.removeEventListener("dragover", over);
        window.removeEventListener("dragleave", leave);
        window.removeEventListener("drop", drop);
      };
    },
    pickAudioFile: async () => "/Users/demo/Music/Neon Skyline.mp3",
    pickModel: async () => "/Users/demo/Downloads/model",
    pickFolder: async () => "/Users/demo/Music/Stems",
    pickSavePath: async (p) => p,
    reveal: async () => {},
    openFolder: async () => {},
    // ?demo=update in the browser preview pretends a newer version exists.
    checkForUpdates: async () => {
      await sleep(900);
      const newer = new URLSearchParams(location.search).get("demo") === "update";
      return {
        currentVersion: "1.0.0-dev",
        available: newer,
        version: newer ? "1.1.0" : null,
        notes: newer ? "- Download tracks from a link\n- Finnish and Swedish" : null,
        date: newer ? "2026-11-08" : null,
      };
    },
    installUpdate: async () => {
      const emit = (e: UpdateEvent) => listeners.update.forEach((l) => l(e));
      for (let i = 1; i <= 10; i++) {
        emit({ kind: "progress", downloaded: i * 3_500_000, total: 35_000_000 });
        await sleep(250);
      }
      emit({ kind: "installed" });
    },
    latestRelease: async () => {
      await sleep(500);
      return {
        version: "1.0.0",
        name: "Prism 1.0.0",
        url: "https://github.com/JonneNieminen/Prism/releases/tag/v1.0.0",
        date: "2026-11-07",
        prerelease: false,
        notes: "## What's new\n\n- **Download a track** from a YouTube, SoundCloud, Instagram or TikTok link\n- A live log shows exactly what Prism is doing while it separates\n- English, Finnish and Swedish\n- Scroll over a volume slider to change it\n\n## Fixes\n\n- The playhead now lands exactly where you click\n- Cancel takes effect at once",
      };
    },
    onUpdate: async (cb) => (listeners.update.add(cb), () => void listeners.update.delete(cb)),
    openUrl: async (u) => void window.open(u, "_blank"),
    joinPath: (dir, name) => `${dir.replace(/\/+$/, "")}/${name}`,
    onMenu: async () => () => {},
    windowAction: async () => {},
  };
}

const cancelled = new Set<string>();
const installed: ModelManifest[] = [];

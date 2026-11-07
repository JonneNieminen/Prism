// Browser-only stand-in for the Rust backend, so the UI can be developed and
// checked with `npm run dev` in a normal browser. Never used inside Tauri.
import type { CatalogEntry, ModelInfo, ModelManifest, Project, Settings } from "../bindings";
import type { Backend, DownloadEvent, JobEvent, OpenProject } from "./ipc";

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
};

const projects: Project[] = [];
const listeners = { sep: new Set<(e: JobEvent) => void>(), dl: new Set<(e: DownloadEvent) => void>() };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const info = (m: ModelManifest, bundled: boolean): ModelInfo => ({
  manifest: m,
  bundled,
  sizeBytes: 174_264_722,
  nonCommercial: false,
  qualities: ["fast", "balanced", "best"],
  problem: null,
});

function demoPeaks(seed: number, n = 1200) {
  return Array.from({ length: n }, (_, i) => {
    const env = 0.35 + 0.35 * Math.sin(i / 90 + seed) ** 2;
    return Math.min(1, env * (0.55 + 0.45 * Math.abs(Math.sin(i * (0.7 + seed * 0.13)))));
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

function demoProject(title: string): Project {
  return {
    id: crypto.randomUUID(),
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
  };
}

const urls = new Map<string, Record<string, string>>();

export function mockBackend(): Backend {
  if (projects.length === 0) projects.push({ ...demoProject("Midnight Drive"), createdAt: Date.now() - 86_400_000 * 2 });
  return {
    appInfo: async () => ({
      version: "0.1.0-dev",
      dataDir: "~/Library/Application Support/com.jonnenieminen.prism",
      libraryBytes: 412_000_000,
      accelCacheBytes: 635_000_000,
      modelsBytes: 0,
      supportedExtensions: ["mp3", "wav", "flac", "m4a", "ogg", "oga", "aac"],
    }),
    getSettings: async () => settings,
    setSettings: async (s) => (settings = s),
    probeAudio: async (path) => {
      await sleep(500);
      const name = path.split("/").pop() ?? path;
      if (name.endsWith(".txt"))
        throw { kind: "unsupportedFile", message: "“.txt” files aren't supported. Try MP3, WAV, FLAC, M4A or OGG." };
      return {
        info: { title: name.replace(/\.[^.]+$/, ""), artist: "Demo Artist", durationSecs: 214.3, sampleRate: 44100, channels: 2, fileName: name },
        peaks: demoPeaks(1),
      };
    },
    startSeparation: async (path) => {
      const jobId = `sep-${crypto.randomUUID()}`;
      const title = (path.split("/").pop() ?? "Song").replace(/\.[^.]+$/, "");
      void (async () => {
        const emit = (e: JobEvent) => listeners.sep.forEach((l) => l(e));
        emit({ kind: "progress", jobId, stage: "decoding", fraction: 0, etaSecs: null, device: null, note: null });
        await sleep(400);
        emit({ kind: "progress", jobId, stage: "loading", fraction: 0, etaSecs: null, device: null, note: null });
        await sleep(600);
        for (let i = 1; i <= 40; i++) {
          if (cancelled.has(jobId)) return emit({ kind: "error", jobId, error: { kind: "cancelled", message: "Cancelled" } });
          emit({ kind: "progress", jobId, stage: "separating", fraction: i / 40, etaSecs: (40 - i) * 0.15, device: "Apple Silicon (Core ML)", note: null });
          await sleep(150);
        }
        const p = demoProject(title);
        projects.unshift(p);
        emit({ kind: "done", jobId, project: p });
      })();
      return jobId;
    },
    cancelJob: async (id) => void cancelled.add(id),
    listProjects: async () => [...projects],
    openProject: async (id): Promise<OpenProject> => {
      const project = projects.find((p) => p.id === id);
      if (!project) throw { kind: "other", message: "This project is no longer in the library." };
      if (!urls.has(id)) urls.set(id, Object.fromEntries(project.stems.map((s, i) => [s.id, synthStem(i)])));
      return {
        project,
        peaks: Object.fromEntries(project.stems.map((s, i) => [s.id, demoPeaks(i * 1.7, 2000)])),
        stemUrls: urls.get(id)!,
      };
    },
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
    openUrl: async (u) => void window.open(u, "_blank"),
    joinPath: (dir, name) => `${dir.replace(/\/+$/, "")}/${name}`,
  };
}

const cancelled = new Set<string>();
const installed: ModelManifest[] = [];

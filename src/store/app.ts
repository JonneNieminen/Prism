import { create } from "zustand";
import type { AppError, MusicInfo, Project, Quality, Settings } from "../bindings";
import { backend, toAppError, type Analysis, type JobEvent, type Models, type OpenProject, type Probe, type Stage } from "../lib/ipc";

export type View = "separate" | "player" | "library" | "models" | "analyze" | "settings" | "help" | "shortcuts";

export type ExportTarget = { kind: "mix" } | { kind: "zip" } | { kind: "stem"; stemId: string };

export type Job = {
  id: string;
  stage: Stage;
  fraction: number;
  eta: number | null;
  device: string | null;
  detail: string | null;
  note: string | null;
  startedAt: number;
  title: string;
  modelId: string;
  modelName: string;
  /** Started automatically from the queue: when it finishes, don't take the user away from what they're doing. */
  fromQueue?: boolean;
};

/** A song waiting to be separated after the current one. */
export type QueuedSong = { path: string; name: string };

export type Toast = {
  id: number;
  tone: "info" | "success" | "error";
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
};

type State = {
  view: View;
  settings: Settings | null;
  models: Models | null;
  source: { path: string; probe: Probe } | null;
  probing: string | null;
  sourceError: AppError | null;
  job: Job | null;
  jobError: AppError | null;
  /** Songs to separate next, in order, with the model and quality of the last separation. */
  queue: QueuedSong[];
  lastRun: { modelId: string; quality: Quality } | null;
  /** Open dropped or picked songs: the first becomes the source (or joins the queue while a separation runs), the rest queue. */
  addSongs(paths: string[]): void;
  removeFromQueue(path: string): void;
  clearQueue(): void;
  startNext(): Promise<void>;
  project: OpenProject | null;
  projects: Project[];
  /** Key and tempo detected after the fact, by project id (the open project object stays untouched). */
  music: Record<string, MusicInfo>;
  toasts: Toast[];
  exportTarget: ExportTarget | null;
  /** A file is being dragged over the window. */
  dragOver: boolean;
  /** Key & BPM view. */
  analysis: (Analysis & { path: string }) | null;
  analyzing: string | null;
  analysisError: AppError | null;
  analyze(path: string): Promise<void>;
  pickAnalysis(): Promise<void>;
  clearAnalysis(): void;
  /** Hand the analysed song to the Separate view (already decoded). */
  separateAnalyzed(): void;

  setExportTarget(t: ExportTarget | null): void;
  pickSource(): Promise<void>;
  go(view: View): void;
  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  refreshModels(): Promise<void>;
  refreshProjects(): Promise<void>;
  loadSource(path: string): Promise<void>;
  clearSource(): void;
  separate(modelId: string, quality: Quality, fromQueue?: boolean): Promise<void>;
  cancelJob(): Promise<void>;
  openProject(id: string): Promise<void>;
  ensureMusic(project: Project): Promise<void>;
  closeProject(): void;
  toast(t: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
};

let toastId = 0;

export const useApp = create<State>((set, get) => ({
  view: "separate",
  settings: null,
  models: null,
  source: null,
  probing: null,
  sourceError: null,
  job: null,
  jobError: null,
  queue: [],
  lastRun: null,
  project: null,
  projects: [],
  music: {},
  toasts: [],
  exportTarget: null,
  dragOver: false,
  analysis: null,
  analyzing: null,
  analysisError: null,

  async analyze(path) {
    set({ analyzing: path, analysisError: null, view: "analyze" });
    try {
      const a = await (await backend()).analyzeTrack(path);
      if (get().analyzing !== path) return;
      set({ analysis: { ...a, path }, analyzing: null });
    } catch (e) {
      if (get().analyzing !== path) return;
      set({ analyzing: null, analysisError: toAppError(e) });
    }
  },

  async pickAnalysis() {
    const b = await backend();
    const info = await b.appInfo();
    const p = await b.pickAudioFile(info.supportedExtensions);
    if (p) await get().analyze(p);
  },

  clearAnalysis: () => set({ analysis: null, analysisError: null }),

  separateAnalyzed() {
    const a = get().analysis;
    if (!a || get().job) return;
    set({ source: { path: a.path, probe: { info: a.info, peaks: a.peaks } }, sourceError: null, jobError: null, view: "separate" });
  },

  go: (view) => set({ view }),
  setExportTarget: (exportTarget) => set({ exportTarget }),

  async pickSource() {
    const b = await backend();
    const info = await b.appInfo();
    const p = await b.pickAudioFile(info.supportedExtensions);
    if (p) await get().loadSource(p);
  },

  async init() {
    const b = await backend();
    const [settings, models, projects] = await Promise.all([b.getSettings(), b.listModels(), b.listProjects()]);
    set({ settings, models, projects });
    await b.onSeparation(onJobEvent);
  },

  async updateSettings(patch) {
    const cur = get().settings;
    if (!cur) return;
    const next = { ...cur, ...patch };
    set({ settings: next });
    try {
      set({ settings: await (await backend()).setSettings(next) });
      if ("activeModelId" in patch) await get().refreshModels();
      if ("libraryRetentionDays" in patch) await get().refreshProjects();
    } catch (e) {
      set({ settings: cur });
      get().toast({ tone: "error", title: "Couldn't save settings", body: toAppError(e).message });
    }
  },

  async refreshModels() {
    set({ models: await (await backend()).listModels() });
  },

  async refreshProjects() {
    set({ projects: await (await backend()).listProjects() });
  },

  async loadSource(path) {
    set({ probing: path, sourceError: null, jobError: null, view: "separate" });
    try {
      const probe = await (await backend()).probeAudio(path);
      if (get().probing !== path) return;
      set({ source: { path, probe }, probing: null });
    } catch (e) {
      if (get().probing !== path) return;
      set({ probing: null, sourceError: toAppError(e) });
    }
  },

  clearSource: () => set({ source: null, sourceError: null, jobError: null }),

  addSongs(paths) {
    const known = new Set([get().source?.path, get().probing, ...get().queue.map((q) => q.path)]);
    const fresh = paths.filter((p) => {
      if (!p || known.has(p)) return false;
      known.add(p);
      return true;
    });
    if (fresh.length === 0) return;
    const busy = !!get().job || get().probing !== null;
    const first = busy ? undefined : fresh[0];
    const rest = busy ? fresh : fresh.slice(1);
    const queued = rest.map((path) => ({ path, name: path.split(/[\\/]/).pop() ?? path }));
    if (queued.length) set({ queue: [...get().queue, ...queued] });
    if (first) void get().loadSource(first);
    else if (queued.length) get().toast({ tone: "info", title: queued.length === 1 ? `“${queued[0].name}” is up next` : `${queued.length} songs added to the queue` });
  },

  removeFromQueue: (path) => set({ queue: get().queue.filter((q) => q.path !== path) }),
  clearQueue: () => set({ queue: [] }),

  async startNext() {
    const next = get().queue[0];
    if (!next || get().job || get().probing) return;
    set({ queue: get().queue.slice(1) });
    const run = get().lastRun ?? (get().settings ? { modelId: get().settings!.activeModelId, quality: get().settings!.quality } : null);
    const failed = (body: string) => {
      get().toast({ tone: "error", title: `Couldn't separate “${next.name}”`, body });
      set({ source: null, sourceError: null, jobError: null });
      void get().startNext();
    };
    if (!run) return failed("Choose a model in Models first.");
    // Probe without switching views: the user may be listening to the song that just finished.
    set({ probing: next.path, sourceError: null, jobError: null });
    try {
      const probe = await (await backend()).probeAudio(next.path);
      if (get().probing !== next.path) return;
      set({ source: { path: next.path, probe }, probing: null });
    } catch (e) {
      if (get().probing !== next.path) return;
      set({ probing: null });
      return failed(toAppError(e).message);
    }
    await get().separate(run.modelId, run.quality, true);
    const err = get().jobError;
    if (err) failed(err.message);
  },

  async separate(modelId, quality, fromQueue = false) {
    const { source, models } = get();
    if (!source) return;
    set({ jobError: null, lastRun: { modelId, quality } });
    try {
      const id = await (await backend()).startSeparation(source.path, modelId, quality);
      const model = models?.listing.models.find((m) => m.manifest.id === modelId);
      set({
        job: {
          id,
          stage: "decoding",
          fraction: 0,
          eta: null,
          device: null,
          detail: null,
          note: null,
          startedAt: Date.now(),
          title: source.probe.info.title,
          modelId,
          modelName: model?.manifest.name ?? modelId,
          fromQueue,
        },
      });
    } catch (e) {
      set({ jobError: toAppError(e) });
    }
  },

  async cancelJob() {
    const job = get().job;
    if (job) await (await backend()).cancelJob(job.id);
  },

  async ensureMusic(project) {
    if (project.music || get().music[project.id]) return;
    try {
      const done = await (await backend()).detectMusic(project.id);
      if (!done.music) return;
      set({
        music: { ...get().music, [project.id]: done.music },
        projects: get().projects.map((p) => (p.id === project.id ? { ...p, music: done.music } : p)),
      });
    } catch {
      // Key and tempo are a nicety; a failure shouldn't interrupt playback.
    }
  },

  async openProject(id) {
    try {
      const project = await (await backend()).openProject(id);
      set({ project, view: "player" });
    } catch (e) {
      get().toast({ tone: "error", title: "Couldn't open project", body: toAppError(e).message });
      void get().refreshProjects();
    }
  },

  closeProject: () => set({ project: null, view: "separate" }),

  toast(t) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.tone === "error" ? 8000 : 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

function onJobEvent(e: JobEvent) {
  const s = useApp.getState();
  if (!s.job || s.job.id !== e.jobId) return;
  if (e.kind === "progress") {
    useApp.setState({
      job: { ...s.job, stage: e.stage, fraction: e.fraction, eta: e.etaSecs, device: e.device ?? s.job.device, detail: e.detail, note: e.note },
    });
  } else if (e.kind === "done") {
    const job = s.job;
    useApp.setState({ job: null, source: null });
    void s.refreshProjects();
    const more = s.queue.length > 0;
    if (e.project) {
      const id = e.project.id;
      // Open it, unless it ran in the background from the queue or more songs follow.
      if (job.fromQueue || more) s.toast({ tone: "success", title: `“${job.title}” is ready`, action: { label: "Open", run: () => void useApp.getState().openProject(id) } });
      else void s.openProject(id);
    }
    if (more) void useApp.getState().startNext();
  } else {
    const job = s.job;
    const cancelled = e.error.kind === "cancelled";
    const more = s.queue.length > 0;
    if (job.fromQueue || more) {
      // Keep going with the rest of the queue; report this one.
      useApp.setState({ job: null, source: null, jobError: null });
      s.toast(cancelled ? { tone: "info", title: `Skipped “${job.title}”` } : { tone: "error", title: `Couldn't separate “${job.title}”`, body: e.error.message });
      void useApp.getState().startNext();
      return;
    }
    useApp.setState({ job: null, jobError: cancelled ? null : e.error });
    if (cancelled) s.toast({ tone: "info", title: "Separation cancelled" });
  }
}

import { create } from "zustand";
import type { AppError, Project, Quality, Settings } from "../bindings";
import { backend, toAppError, type JobEvent, type Models, type OpenProject, type Probe, type Stage } from "../lib/ipc";

export type View = "separate" | "player" | "library" | "models" | "settings";

export type Job = {
  id: string;
  stage: Stage;
  fraction: number;
  eta: number | null;
  device: string | null;
  note: string | null;
  title: string;
  modelId: string;
  modelName: string;
};

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
  project: OpenProject | null;
  projects: Project[];
  toasts: Toast[];

  go(view: View): void;
  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  refreshModels(): Promise<void>;
  refreshProjects(): Promise<void>;
  loadSource(path: string): Promise<void>;
  clearSource(): void;
  separate(modelId: string, quality: Quality): Promise<void>;
  cancelJob(): Promise<void>;
  openProject(id: string): Promise<void>;
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
  project: null,
  projects: [],
  toasts: [],

  go: (view) => set({ view }),

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

  async separate(modelId, quality) {
    const { source, models } = get();
    if (!source) return;
    set({ jobError: null });
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
          note: null,
          title: source.probe.info.title,
          modelId,
          modelName: model?.manifest.name ?? modelId,
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
      job: { ...s.job, stage: e.stage, fraction: e.fraction, eta: e.etaSecs, device: e.device ?? s.job.device, note: e.note },
    });
  } else if (e.kind === "done") {
    useApp.setState({ job: null, source: null });
    void s.refreshProjects();
    if (e.project) void s.openProject(e.project.id);
  } else {
    useApp.setState({ job: null, jobError: e.error.kind === "cancelled" ? null : e.error });
    if (e.error.kind === "cancelled") s.toast({ tone: "info", title: "Separation cancelled" });
  }
}

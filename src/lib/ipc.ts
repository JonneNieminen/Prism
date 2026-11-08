// Typed bridge to the Rust backend (src-tauri/src/lib.rs). In a plain browser
// (`npm run dev` without Tauri) a mock backend is used so the UI can be built
// and checked without the native shell.
import type {
  AppError,
  CatalogEntry,
  ExportOptions,
  Link,
  MixGain,
  ModelListing,
  ModelManifest,
  MusicInfo,
  Platform,
  Project,
  Quality,
  ReleaseInfo,
  Settings,
  TrackInfo,
} from "../bindings";

export type AppInfo = {
  version: string;
  dataDir: string;
  libraryBytes: number;
  accelCacheBytes: number;
  modelsBytes: number;
  supportedExtensions: string[];
};
export type Probe = { info: TrackInfo; peaks: number[] };
export type Analysis = Probe & { music: MusicInfo; secs: number };
export type OpenProject = {
  project: Project;
  peaks: Record<string, number[]>;
  /** stem id → URL playable by Web Audio */
  stemUrls: Record<string, string>;
};
export type Models = { listing: ModelListing; activeId: string };
export type Stage = "decoding" | "loading" | "separating" | "saving";
export type JobEvent =
  | {
      kind: "progress";
      jobId: string;
      stage: Stage;
      fraction: number;
      etaSecs: number | null;
      device: string | null;
      detail: string | null;
      note: string | null;
    }
  | { kind: "log"; jobId: string; level: "info" | "warn"; text: string }
  | { kind: "done"; jobId: string; project: Project | null }
  | { kind: "error"; jobId: string; error: AppError };
export type DownloadEvent =
  | { kind: "progress"; jobId: string; done: number; total: number }
  | { kind: "done"; jobId: string; modelId: string }
  | { kind: "error"; jobId: string; error: AppError };
export type TrackStage = "fetch" | "download" | "save";
export type TrackEvent =
  | {
      kind: "progress";
      jobId: string;
      stage: TrackStage;
      platform: Platform;
      title: string | null;
      uploader: string | null;
      fraction: number | null;
      doneBytes: number | null;
      totalBytes: number | null;
      speed: number | null;
      etaSecs: number | null;
    }
  | { kind: "done"; jobId: string; path: string; title: string; separable: boolean }
  | { kind: "error"; jobId: string; error: AppError };
export type UpdateInfo = { currentVersion: string; available: boolean; version: string | null; notes: string | null; date: string | null };
export type UpdateEvent =
  | { kind: "available"; info: UpdateInfo }
  | { kind: "progress"; downloaded: number; total: number | null }
  | { kind: "installed" };
export type DragDrop = { type: "enter" | "over" | "leave" | "drop"; paths: string[] };

export interface Backend {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<Settings>;
  probeAudio(path: string): Promise<Probe>;
  /** Key & BPM only (no separation). */
  analyzeTrack(path: string): Promise<Analysis>;
  startSeparation(path: string, modelId: string, quality: Quality): Promise<string>;
  cancelJob(jobId: string): Promise<void>;
  /** Recognise the platform of a pasted link; rejects with a reason if it can't be downloaded. */
  classifyLink(url: string): Promise<Link>;
  startTrackDownload(url: string): Promise<string>;
  /** Where downloaded tracks are saved right now (the setting, or the default). */
  trackDownloadDir(): Promise<string>;
  onTrackDownload(cb: (e: TrackEvent) => void): Promise<() => void>;
  listProjects(): Promise<Project[]>;
  openProject(id: string): Promise<OpenProject>;
  /** Estimate key and tempo for a project saved before detection existed. */
  detectMusic(id: string): Promise<Project>;
  renameProject(id: string, title: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  clearCache(library: boolean, accelerator: boolean): Promise<void>;
  suggestFileName(title: string, suffix: string, ext: string): Promise<string>;
  exportStem(projectId: string, stemId: string, options: ExportOptions, target: string): Promise<void>;
  exportMix(projectId: string, gains: MixGain[], options: ExportOptions, target: string): Promise<void>;
  exportZip(jobId: string, projectId: string, options: ExportOptions, target: string): Promise<void>;
  listModels(): Promise<Models>;
  importModel(path: string): Promise<ModelManifest>;
  removeModel(id: string): Promise<void>;
  fetchCatalog(): Promise<{ entries: CatalogEntry[]; warnings: string[] }>;
  installCatalogModel(jobId: string, entry: CatalogEntry): Promise<void>;
  onSeparation(cb: (e: JobEvent) => void): Promise<() => void>;
  onDownload(cb: (e: DownloadEvent) => void): Promise<() => void>;
  onExportProgress(cb: (e: { jobId: string; fraction: number }) => void): Promise<() => void>;
  onDragDrop(cb: (e: DragDrop) => void): Promise<() => void>;
  pickAudioFile(extensions: string[]): Promise<string | null>;
  pickModel(kind: "folder" | "zip"): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  pickSavePath(defaultPath: string, ext: string): Promise<string | null>;
  reveal(path: string): Promise<void>;
  /** Open a folder in the system file manager; `create` makes it first if it is missing. */
  openFolder(path: string, create?: boolean): Promise<void>;
  /** Look for a new version now. */
  checkForUpdates(): Promise<UpdateInfo>;
  /** Download and install the update found by the last check, then restart. */
  installUpdate(): Promise<void>;
  /** What the latest GitHub release says, newer than this version or not. */
  latestRelease(): Promise<ReleaseInfo>;
  onUpdate(cb: (e: UpdateEvent) => void): Promise<() => void>;
  openUrl(url: string): Promise<void>;
  joinPath(dir: string, name: string): string;
  /** Native menu selections (ids match `CommandId`). */
  onMenu(cb: (id: string) => void): Promise<() => void>;
  windowAction(a: "minimize" | "fullscreen" | "hide" | "quit"): Promise<void>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const dialog = await import("@tauri-apps/plugin-dialog");
  const opener = await import("@tauri-apps/plugin-opener");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const on = <T,>(name: string, cb: (p: T) => void) => listen<T>(name, (e) => cb(e.payload));
  return {
    appInfo: () => invoke("app_info"),
    getSettings: () => invoke("get_settings"),
    setSettings: (settings) => invoke("set_settings", { settings }),
    probeAudio: (path) => invoke("probe_audio", { path }),
    analyzeTrack: (path) => invoke("analyze_track", { path }),
    startSeparation: (path, modelId, quality) => invoke("start_separation", { path, modelId, quality }),
    cancelJob: (jobId) => invoke("cancel_job", { jobId }),
    classifyLink: (url) => invoke("classify_link", { url }),
    startTrackDownload: (url) => invoke("start_track_download", { url }),
    trackDownloadDir: () => invoke("track_download_dir"),
    onTrackDownload: (cb) => on("track-download", cb),
    listProjects: () => invoke("list_projects"),
    openProject: async (id) => {
      const r = await invoke<{ project: Project; peaks: Record<string, number[]>; stemPaths: Record<string, string> }>(
        "open_project",
        { id },
      );
      const stemUrls = Object.fromEntries(Object.entries(r.stemPaths).map(([k, p]) => [k, convertFileSrc(p)]));
      return { project: r.project, peaks: r.peaks, stemUrls };
    },
    detectMusic: (id) => invoke("detect_music", { id }),
    renameProject: (id, title) => invoke("rename_project", { id, title }),
    deleteProject: (id) => invoke("delete_project", { id }),
    clearCache: (library, accelerator) => invoke("clear_cache", { library, accelerator }),
    suggestFileName: (title, suffix, ext) => invoke("suggest_file_name", { title, suffix, ext }),
    exportStem: (projectId, stemId, options, target) => invoke("export_stem", { projectId, stemId, options, target }),
    exportMix: (projectId, gains, options, target) => invoke("export_mix", { projectId, gains, options, target }),
    exportZip: (jobId, projectId, options, target) => invoke("export_zip", { jobId, projectId, options, target }),
    listModels: () => invoke("list_models"),
    importModel: (path) => invoke("import_model", { path }),
    removeModel: (id) => invoke("remove_model", { id }),
    fetchCatalog: () => invoke("fetch_catalog"),
    installCatalogModel: (jobId, entry) => invoke("install_catalog_model", { jobId, entry }),
    onSeparation: (cb) => on("separation", cb),
    onDownload: (cb) => on("model-download", cb),
    onExportProgress: (cb) => on("export-progress", cb),
    onDragDrop: (cb) =>
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        cb({ type: p.type, paths: "paths" in p ? p.paths : [] });
      }),
    pickAudioFile: async (extensions) =>
      (await dialog.open({ multiple: false, directory: false, filters: [{ name: "Audio", extensions }] })) as string | null,
    pickModel: async (kind) =>
      (await dialog.open({
        multiple: false,
        directory: kind === "folder",
        filters: kind === "zip" ? [{ name: "Model package", extensions: ["zip"] }] : undefined,
      })) as string | null,
    pickFolder: async () => (await dialog.open({ multiple: false, directory: true })) as string | null,
    pickSavePath: async (defaultPath, ext) =>
      dialog.save({ defaultPath, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }),
    reveal: (path) => opener.revealItemInDir(path),
    openFolder: (path, create = false) => invoke("open_folder", { path, create }),
    checkForUpdates: () => invoke("check_for_updates"),
    installUpdate: () => invoke("install_update"),
    latestRelease: () => invoke("latest_release"),
    onUpdate: (cb) => on("update", cb),
    openUrl: (url) => opener.openUrl(url),
    joinPath: (dir, name) => `${dir.replace(/\/+$/, "")}/${name}`,
    onMenu: (cb) => on<string>("menu", cb),
    windowAction: async (a) => {
      const w = getCurrentWindow();
      if (a === "minimize") await w.minimize();
      else if (a === "fullscreen") await w.setFullscreen(!(await w.isFullscreen()));
      else if (a === "hide") await w.hide();
      else await invoke("quit_app");
    },
  };
}

let backendPromise: Promise<Backend> | null = null;
export function backend(): Promise<Backend> {
  backendPromise ??= isTauri ? tauriBackend() : import("./mock").then((m) => m.mockBackend());
  return backendPromise;
}

/** Normalise anything thrown by a command into an AppError. */
export function toAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "message" in e && "kind" in e) return e as AppError;
  return { kind: "other", message: typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong." };
}

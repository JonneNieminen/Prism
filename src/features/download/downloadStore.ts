import { create } from "zustand";
import type { AppError, Platform } from "../../bindings";
import { tr } from "../../i18n";
import { backend, toAppError, type TrackEvent, type TrackStage } from "../../lib/ipc";
import { useApp } from "../../store/app";

export type Track = {
  id: string;
  platform: Platform;
  stage: TrackStage;
  title: string | null;
  uploader: string | null;
  fraction: number | null;
  doneBytes: number | null;
  totalBytes: number | null;
  speed: number | null;
  eta: number | null;
  startedAt: number;
};
export type TrackResult = { path: string; title: string; separable: boolean };

type State = {
  url: string;
  track: Track | null;
  result: TrackResult | null;
  error: AppError | null;
  setUrl(url: string): void;
  start(url: string, platform: Platform): Promise<void>;
  cancel(): Promise<void>;
  /** Back to the empty form. */
  reset(): void;
  /** Hand the downloaded file to the Separate screen. */
  separate(): void;
};

let listening = false;
async function listen() {
  if (listening) return;
  listening = true;
  await (await backend()).onTrackDownload(onEvent);
}

export const useDownload = create<State>((set, get) => ({
  url: "",
  track: null,
  result: null,
  error: null,

  setUrl: (url) => set({ url, error: null }),

  async start(url, platform) {
    if (get().track) return;
    set({ error: null, result: null });
    try {
      await listen();
      const id = await (await backend()).startTrackDownload(url);
      set({
        track: { id, platform, stage: "fetch", title: null, uploader: null, fraction: null, doneBytes: null, totalBytes: null, speed: null, eta: null, startedAt: Date.now() },
      });
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async cancel() {
    const t = get().track;
    if (t) await (await backend()).cancelJob(t.id);
  },

  reset: () => set({ url: "", track: null, result: null, error: null }),

  separate() {
    const r = get().result;
    if (!r?.separable) return;
    useApp.getState().addSongs([r.path]);
    useApp.getState().go("separate");
  },
}));

function onEvent(e: TrackEvent) {
  const s = useDownload.getState();
  if (!s.track || s.track.id !== e.jobId) return;
  if (e.kind === "progress") {
    useDownload.setState({
      track: { ...s.track, stage: e.stage, platform: e.platform, title: e.title ?? s.track.title, uploader: e.uploader ?? s.track.uploader, fraction: e.fraction, doneBytes: e.doneBytes, totalBytes: e.totalBytes, speed: e.speed, eta: e.etaSecs },
    });
  } else if (e.kind === "done") {
    useDownload.setState({ track: null, result: { path: e.path, title: e.title, separable: e.separable } });
    const app = useApp.getState();
    if (app.view !== "download") {
      app.toast({ tone: "success", title: tr("Downloaded “{title}”", { title: e.title }), action: { label: tr("Open"), run: () => useApp.getState().go("download") } });
    }
  } else {
    useDownload.setState({ track: null, error: e.error.kind === "cancelled" ? null : e.error });
  }
}

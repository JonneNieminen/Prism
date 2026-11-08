import { create } from "zustand";
import type { ReleaseInfo } from "../../bindings";
import { tr } from "../../i18n";
import { backend, toAppError, type UpdateEvent, type UpdateInfo } from "../../lib/ipc";
import { useApp } from "../../store/app";

type Status = "idle" | "checking" | "upToDate" | "available" | "installing" | "error";

type State = {
  status: Status;
  /** The newer version found by the last check. */
  update: UpdateInfo | null;
  /** The latest published release (its notes), whether or not it is newer. */
  release: ReleaseInfo | null;
  releaseState: "idle" | "loading" | "error";
  /** 0..1 while an update downloads, null when the size isn't known. */
  progress: number | null;
  error: string | null;
  check(): Promise<void>;
  loadRelease(): Promise<void>;
  install(): Promise<void>;
};

export const useUpdates = create<State>((set, get) => ({
  status: "idle",
  update: null,
  release: null,
  releaseState: "idle",
  progress: null,
  error: null,

  async check() {
    if (get().status === "checking" || get().status === "installing") return;
    set({ status: "checking", error: null });
    try {
      const info = await (await backend()).checkForUpdates();
      set(info.available ? { status: "available", update: info } : { status: "upToDate", update: null });
    } catch (e) {
      set({ status: "error", error: toAppError(e).message });
    }
  },

  async loadRelease() {
    if (get().releaseState === "loading") return;
    set({ releaseState: "loading" });
    try {
      set({ release: await (await backend()).latestRelease(), releaseState: "idle" });
    } catch {
      set({ releaseState: "error" });
    }
  },

  async install() {
    if (get().status !== "available") return;
    set({ status: "installing", progress: 0, error: null });
    try {
      await (await backend()).installUpdate(); // the app restarts when this succeeds
    } catch (e) {
      set({ status: "error", error: toAppError(e).message });
    }
  },
}));

/** Listen for the background check and for install progress. Called once at start. */
export async function listenForUpdates() {
  (await backend()).onUpdate((e: UpdateEvent) => {
    if (e.kind === "available") {
      useUpdates.setState({ status: "available", update: e.info });
      useApp.getState().toast({
        tone: "info",
        title: tr("Prism {version} is available", { version: e.info.version ?? "" }),
        action: { label: tr("Update…"), run: () => useApp.getState().go("settings") },
      });
    } else if (e.kind === "progress") {
      useUpdates.setState({ progress: e.total ? Math.min(0.99, e.downloaded / e.total) : 0 });
    } else if (e.kind === "installed") {
      useUpdates.setState({ progress: 1 });
    }
  });
}

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Upload } from "lucide-react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TooltipLayer } from "./components/Tooltip";
import { Spinner } from "./components/ui";
import { AnalyzeView } from "./features/analyze/AnalyzeView";
import { useDownload } from "./features/download/downloadStore";
import { DownloadView } from "./features/download/DownloadView";
import { HelpView } from "./features/help/HelpView";
import { ShortcutsView } from "./features/help/ShortcutsView";
import { SeparateView } from "./features/import/SeparateView";
import { LibraryView } from "./features/library/LibraryView";
import { ModelsView } from "./features/models/ModelsView";
import { PlayerView } from "./features/player/PlayerView";
import { SettingsView } from "./features/settings/SettingsView";
import { runCommand } from "./lib/commands";
import { backend, isTauri, toAppError } from "./lib/ipc";
import { hasMod, matchEvent, type CommandId } from "./lib/shortcuts";
import { useApp, type View } from "./store/app";
import { setLanguage, tr } from "./i18n";
import { useT } from "./i18n/useT";

function useTheme() {
  const pref = useApp((s) => s.settings?.theme ?? "system");
  const [system, setSystem] = useState(() => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: light)");
    const on = () => setSystem(mq.matches ? "light" : "dark");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const theme = pref === "system" ? system : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return theme;
}

/** Page-level keyboard shortcuts (the native menu triggers the same commands). */
function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (document.querySelector("[role=dialog]")) return; // dialogs handle their own keys
      const t = e.target as HTMLElement;
      const hit = matchEvent(e);
      if (!hit) return;
      const mod = hasMod(e);
      const typing = !!t.closest("input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable=true]");
      if (typing && (!mod || hit.id === "masterUp" || hit.id === "masterDown")) return;
      // Keep native behaviour where the keyboard is driving a control.
      const kbFocused = t.matches(":focus-visible");
      if (!mod && hit.id === "playPause" && kbFocused && t.closest("button, [role=radio], [role=switch]")) return;
      if (!mod && hit.id.startsWith("seek") && t.closest("input[type=range], [role=radiogroup]")) return;
      e.preventDefault();
      void runCommand(hit.id, "index" in hit ? hit.index : 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drop a song anywhere in the window to open it.
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void backend().then(async (b) => {
      const o = await b.onDragDrop((e) => {
        if (e.type === "enter" || e.type === "over") useApp.setState({ dragOver: true });
        else if (e.type === "leave") useApp.setState({ dragOver: false });
        else {
          useApp.setState({ dragOver: false });
          const st = useApp.getState();
          if (!e.paths[0]) return;
          if (st.view === "analyze") void st.analyze(e.paths[0]);
          else st.addSongs(e.paths);
        }
      });
      if (alive) off = o;
      else o();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  // Native macOS menu → same commands.
  useEffect(() => {
    let off: (() => void) | undefined;
    void backend().then(async (b) => {
      off = await b.onMenu((id) => {
        if (id.startsWith("theme:")) return void useApp.getState().updateSettings({ theme: id.slice(6) as "system" | "light" | "dark" });
        void runCommand(id as CommandId);
      });
    });
    return () => off?.();
  }, []);
}

export function App() {
  const { t, lang } = useT();
  setLanguage(lang); // before the children render, so plain tr() calls follow the chosen language
  const init = useApp((s) => s.init);
  const view = useApp((s) => s.view);
  const ready = useApp((s) => !!s.settings);
  const project = useApp((s) => s.project);
  const [fatal, setFatal] = useState<string | null>(null);
  const theme = useTheme();
  useKeyboard();

  useEffect(() => {
    init()
      .then(async () => {
        // Browser preview only (used by scripts/screenshots.sh for the README):
        // ?view=player&theme=light&lang=fi&demo=separating|download
        if (isTauri) return;
        const q = new URLSearchParams(location.search);
        const app = useApp.getState();
        const themeParam = q.get("theme");
        if (themeParam === "light" || themeParam === "dark") await app.updateSettings({ theme: themeParam });
        const langParam = q.get("lang");
        if (langParam === "fi" || langParam === "sv" || langParam === "en") await app.updateSettings({ language: langParam });
        const v = q.get("view") as View | null;
        if (v === "player") {
          const p = app.projects[0];
          if (p) await app.openProject(p.id);
        } else if (v) app.go(v);
        const demo = q.get("demo");
        if (demo === "separating") {
          await app.loadSource("/Users/demo/Music/Neon Skyline.mp3");
          const s = useApp.getState().settings;
          if (s) await useApp.getState().separate(s.activeModelId, s.quality);
        } else if (demo === "download") {
          useDownload.getState().setUrl("https://soundcloud.com/artist/neon-skyline");
          await useDownload.getState().start("https://soundcloud.com/artist/neon-skyline", "soundCloud");
        }
      })
      .catch((e) => setFatal(toAppError(e).message));
  }, [init]);

  const current = view === "player" && !project ? "separate" : view;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full overflow-hidden bg-bg">
        <Sidebar />
        <main className="scroll-area relative flex-1 px-9">
          <div data-tauri-drag-region className="sticky top-0 z-10 -mx-9 h-10" />
          {fatal ? (
            <div role="alert" className="mx-auto mt-24 max-w-md text-center">
              <h1 className="text-[17px] font-semibold">{t("Prism couldn't start")}</h1>
              <p className="mt-2 text-[13px] text-muted">{fatal}</p>
            </div>
          ) : !ready ? (
            <div className="flex h-[70%] items-center justify-center text-muted">
              <Spinner />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={current} className="-mt-10 min-h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                <Boundary>
                  {current === "separate" && <SeparateView />}
                  {current === "download" && <DownloadView />}
                  {current === "player" && <PlayerView theme={theme} />}
                  {current === "library" && <LibraryView />}
                  {current === "models" && <ModelsView />}
                  {current === "analyze" && <AnalyzeView />}
                  {current === "settings" && <SettingsView />}
                  {current === "help" && <HelpView />}
                  {current === "shortcuts" && <ShortcutsView />}
                </Boundary>
              </motion.div>
            </AnimatePresence>
          )}
        </main>
        <DropOverlay />
        <Toasts />
        <TooltipLayer />
      </div>
    </MotionConfig>
  );
}

/** Shown while a file is dragged over any screen except Separate (which has its own drop zone). */
function DropOverlay() {
  const { t } = useT();
  const show = useApp((s) => s.dragOver && s.view !== "separate" && s.view !== "analyze");
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[var(--overlay)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <div className="rounded-2xl border-[1.5px] border-dashed border-accent bg-surface px-10 py-8 text-center shadow-[var(--shadow-pop)]">
            <Upload size={22} className="mx-auto mb-3 text-accent" />
            <div className="text-[15px] font-medium">{t("Drop to open in Prism")}</div>
            <div className="mt-1 text-[12px] text-muted">{t("MP3, WAV, FLAC, M4A or OGG")}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Keeps a rendering bug in one view from blanking the whole window. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-24 max-w-md text-center">
        <h1 className="text-[17px] font-semibold">{tr("This view hit a problem")}</h1>
        <p className="mt-2 text-[13px] text-muted">{this.state.error.message}</p>
        <button className="mt-4 text-[13px] font-medium text-accent" onClick={() => this.setState({ error: null })}>
          {tr("Try again")}
        </button>
      </div>
    );
  }
}

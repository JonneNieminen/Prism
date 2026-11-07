import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TooltipLayer } from "./components/Tooltip";
import { Spinner } from "./components/ui";
import { HelpView } from "./features/help/HelpView";
import { ShortcutsView } from "./features/help/ShortcutsView";
import { SeparateView } from "./features/import/SeparateView";
import { LibraryView } from "./features/library/LibraryView";
import { ModelsView } from "./features/models/ModelsView";
import { PlayerView } from "./features/player/PlayerView";
import { SettingsView } from "./features/settings/SettingsView";
import { runCommand } from "./lib/commands";
import { backend, isTauri, toAppError } from "./lib/ipc";
import { matchEvent, type CommandId } from "./lib/shortcuts";
import { useApp, type View } from "./store/app";

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
      const mod = e.metaKey || e.ctrlKey;
      const typing = !!t.closest("input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable=true]");
      if (typing && !mod) return;
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
        // Browser preview only: ?view=player&theme=light (used for README screenshots).
        if (isTauri) return;
        const q = new URLSearchParams(location.search);
        const t = q.get("theme");
        if (t === "light" || t === "dark") await useApp.getState().updateSettings({ theme: t });
        const v = q.get("view") as View | null;
        if (v === "player") {
          const p = useApp.getState().projects[0];
          if (p) await useApp.getState().openProject(p.id);
        } else if (v) useApp.getState().go(v);
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
              <h1 className="text-[17px] font-semibold">Prism couldn't start</h1>
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
                  {current === "player" && <PlayerView theme={theme} />}
                  {current === "library" && <LibraryView />}
                  {current === "models" && <ModelsView />}
                  {current === "settings" && <SettingsView />}
                  {current === "help" && <HelpView />}
                  {current === "shortcuts" && <ShortcutsView />}
                </Boundary>
              </motion.div>
            </AnimatePresence>
          )}
        </main>
        <Toasts />
        <TooltipLayer />
      </div>
    </MotionConfig>
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
        <h1 className="text-[17px] font-semibold">This view hit a problem</h1>
        <p className="mt-2 text-[13px] text-muted">{this.state.error.message}</p>
        <button className="mt-4 text-[13px] font-medium text-accent" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

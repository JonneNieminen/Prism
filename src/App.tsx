import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Spinner } from "./components/ui";
import { LibraryView } from "./features/library/LibraryView";
import { ModelsView } from "./features/models/ModelsView";
import { PlayerView } from "./features/player/PlayerView";
import { SeparateView } from "./features/import/SeparateView";
import { SettingsView } from "./features/settings/SettingsView";
import { toAppError } from "./lib/ipc";
import { useApp } from "./store/app";

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

export function App() {
  const init = useApp((s) => s.init);
  const view = useApp((s) => s.view);
  const ready = useApp((s) => !!s.settings);
  const project = useApp((s) => s.project);
  const [fatal, setFatal] = useState<string | null>(null);
  const theme = useTheme();

  useEffect(() => {
    init().catch((e) => setFatal(toAppError(e).message));
  }, [init]);

  const current = view === "player" && !project ? "separate" : view;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full overflow-hidden">
        {/* ambient refraction glow */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/3 h-[520px] w-[520px] rounded-full bg-[var(--brand-from)] opacity-[0.07] blur-[120px]" />
          <div className="absolute -right-32 bottom-[-160px] h-[460px] w-[460px] rounded-full bg-[var(--brand-to)] opacity-[0.06] blur-[120px]" />
        </div>
        <Sidebar />
        <main className="scroll-area relative flex-1 px-10">
          <div data-tauri-drag-region className="sticky top-0 z-10 -mx-10 h-11" />
          {fatal ? (
            <div role="alert" className="mx-auto mt-24 max-w-md text-center">
              <h1 className="font-display text-xl font-semibold">Prism couldn't start</h1>
              <p className="mt-2 text-sm text-muted">{fatal}</p>
            </div>
          ) : !ready ? (
            <div className="flex h-[70%] items-center justify-center text-muted">
              <Spinner />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                className="-mt-11 min-h-full"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <Boundary>
                {current === "separate" && <SeparateView />}
                {current === "player" && <PlayerView theme={theme} />}
                {current === "library" && <LibraryView />}
                {current === "models" && <ModelsView />}
                {current === "settings" && <SettingsView />}
                </Boundary>
              </motion.div>
            </AnimatePresence>
          )}
        </main>
        <Toasts />
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
        <h1 className="font-display text-xl font-semibold">This view hit a problem</h1>
        <p className="mt-2 text-sm text-muted">{this.state.error.message}</p>
        <button className="brand-text mt-4 text-sm font-semibold" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

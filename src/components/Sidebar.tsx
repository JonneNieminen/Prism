import { motion } from "motion/react";
import { AudioLines, Boxes, Library, Settings2, Sparkles } from "lucide-react";
import { useApp, type View } from "../store/app";
import { Wordmark } from "./Logo";
import { cx } from "./ui";

const NAV: { view: View; label: string; icon: typeof Sparkles }[] = [
  { view: "separate", label: "Separate", icon: Sparkles },
  { view: "library", label: "Library", icon: Library },
  { view: "models", label: "Models", icon: Boxes },
  { view: "settings", label: "Settings", icon: Settings2 },
];

export function Sidebar() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const project = useApp((s) => s.project);
  const job = useApp((s) => s.job);
  const items = project
    ? [NAV[0], { view: "player" as View, label: project.project.title, icon: AudioLines }, ...NAV.slice(1)]
    : NAV;

  return (
    <nav aria-label="Main" className="glass relative z-10 flex w-[232px] shrink-0 flex-col border-y-0 border-l-0 px-3 pt-11 pb-4">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-11" />
      <div className="mb-7 px-3">
        <Wordmark />
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((it) => {
          const active = view === it.view;
          const Icon = it.icon;
          return (
            <li key={it.view}>
              <button
                onClick={() => go(it.view)}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors",
                  active ? "text-text" : "text-muted hover:text-text",
                  it.view === "player" && "pl-5",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-xl border border-hairline bg-elevated"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon size={17} className="relative shrink-0" />
                <span className="relative truncate">{it.label}</span>
                {it.view === "separate" && job && (
                  <span className="relative ml-auto h-2 w-2 animate-pulse rounded-full brand-gradient" aria-label="Separation running" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto px-3 text-[11px] leading-relaxed text-muted">
        Runs entirely on this Mac.
        <br />
        Your audio never leaves it.
      </div>
    </nav>
  );
}

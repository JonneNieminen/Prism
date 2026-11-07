import { AudioLines, Boxes, Keyboard, Library, LifeBuoy, Monitor, Moon, Settings2, Sparkles, Sun } from "lucide-react";
import type { Theme } from "../bindings";
import { useApp, type View } from "../store/app";
import { Logo } from "./Logo";
import { Segmented, cx } from "./ui";

type Item = { view: View; label: string; icon: typeof Sparkles; shortcut?: string; tip: string };

const MAIN: Item[] = [
  { view: "separate", label: "Separate", icon: Sparkles, shortcut: "goSeparate", tip: "Load a song and split it into stems" },
  { view: "library", label: "Library", icon: Library, shortcut: "goLibrary", tip: "Songs you've already separated" },
  { view: "models", label: "Models", icon: Boxes, shortcut: "goModels", tip: "Installed and downloadable models" },
];
const MORE: Item[] = [
  { view: "help", label: "Help", icon: LifeBuoy, shortcut: "goHelp", tip: "How to use Prism" },
  { view: "shortcuts", label: "Shortcuts", icon: Keyboard, shortcut: "goShortcuts", tip: "Every keyboard shortcut" },
  { view: "settings", label: "Settings", icon: Settings2, shortcut: "goSettings", tip: "Preferences and storage" },
];

export function Sidebar() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const project = useApp((s) => s.project);
  const job = useApp((s) => s.job);
  const theme = useApp((s) => s.settings?.theme ?? "system");
  const update = useApp((s) => s.updateSettings);

  const row = (it: Item, indent = false) => {
    const active = view === it.view;
    const Icon = it.icon;
    return (
      <li key={it.view}>
        <button
          onClick={() => go(it.view)}
          aria-current={active ? "page" : undefined}
          data-tip={it.tip}
          data-shortcut={it.shortcut}
          className={cx(
            "flex h-[30px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors",
            active ? "bg-pressed text-text" : "text-text/85 hover:bg-elevated/70",
            indent && "pl-7",
          )}
        >
          <Icon size={15} className={cx("shrink-0", active ? "text-accent" : "text-muted")} />
          <span className="truncate">{it.label}</span>
          {it.view === "separate" && job && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-label="Separation running" />}
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Main" className="relative z-10 flex w-[220px] shrink-0 flex-col border-r border-border bg-sidebar px-2.5 pt-12 pb-3">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-12" />
      <div className="mb-5 flex items-center gap-2 px-2.5">
        <Logo size={24} />
        <span className="font-display text-[15px] font-semibold tracking-tight">Prism</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {row(MAIN[0])}
        {project &&
          row(
            { view: "player", label: project.project.title, icon: AudioLines, shortcut: "goPlayer", tip: `Player · ${project.project.title}` },
            true,
          )}
        {MAIN.slice(1).map((i) => row(i))}
      </ul>
      <div className="mt-5 mb-1.5 px-2.5 text-[11px] font-semibold text-muted">More</div>
      <ul className="flex flex-col gap-0.5">{MORE.map((i) => row(i))}</ul>

      <div className="mt-auto flex flex-col gap-3 px-1">
        <Segmented<Theme>
          label="Appearance"
          size="sm"
          full
          value={theme}
          onChange={(v) => void update({ theme: v })}
          options={[
            { value: "system", label: <Monitor size={13} />, aria: "Match system", tip: "Match macOS appearance" },
            { value: "light", label: <Sun size={13} />, aria: "Light", tip: "Light appearance", shortcut: "toggleTheme" },
            { value: "dark", label: <Moon size={13} />, aria: "Dark", tip: "Dark appearance", shortcut: "toggleTheme" },
          ]}
        />
        <p className="px-1.5 text-[11px] leading-relaxed text-faint">Runs entirely on this Mac. Your audio never leaves it.</p>
      </div>
    </nav>
  );
}

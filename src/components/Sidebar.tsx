import { ArrowDownToLine, AudioLines, Boxes, Metronome, CircleHelp, Keyboard, Library, Monitor, Moon, Settings2, Sun } from "lucide-react";
import type { Theme } from "../bindings";
import { useApp, type View } from "../store/app";
import { StackedStems, type IconType } from "./icons";
import { Wordmark } from "./Logo";
import { MasterVolume } from "./MasterVolume";
import { Segmented, cx } from "./ui";
import { thisComputer } from "../lib/platform";
import { mark } from "../i18n";
import { useT } from "../i18n/useT";

type Item = { view: View; label: string; icon: IconType; shortcut?: string; tip: string; raw?: boolean };

const MAIN: Item[] = [
  { view: "separate", label: mark("Separate"), icon: StackedStems, shortcut: "goSeparate", tip: "Load a song and split it into stems" },
  { view: "download", label: mark("Download track"), icon: ArrowDownToLine, shortcut: "goDownload", tip: "Download a track from a YouTube, SoundCloud, Instagram or TikTok link" },
  { view: "analyze", label: mark("Key & BPM"), icon: Metronome, shortcut: "goAnalyze", tip: "Find a song's tempo and key — no separation" },
  { view: "library", label: mark("Library"), icon: Library, shortcut: "goLibrary", tip: "Songs you've already separated" },
  { view: "models", label: mark("Models"), icon: Boxes, shortcut: "goModels", tip: "Installed and downloadable models" },
];
const MORE: Item[] = [
  { view: "help", label: mark("Help"), icon: CircleHelp, shortcut: "goHelp", tip: "How to use Prism" },
  { view: "shortcuts", label: mark("Shortcuts"), icon: Keyboard, shortcut: "goShortcuts", tip: "Every keyboard shortcut" },
  { view: "settings", label: mark("Settings"), icon: Settings2, shortcut: "goSettings", tip: "Preferences and storage" },
];

export function Sidebar() {
  const { t } = useT();
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
          data-tip={it.raw ? it.tip : t(it.tip)}
          data-shortcut={it.shortcut}
          className={cx(
            "flex h-[30px] w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors",
            active ? "bg-pressed text-text" : "text-text/85 hover:bg-elevated/70",
            indent && "pl-7",
          )}
        >
          <Icon size={15} className={cx("shrink-0", active ? "text-accent" : "text-muted")} />
          <span className="truncate">{it.raw ? it.label : t(it.label)}</span>
          {it.view === "separate" && job && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-label={t("Separation running")} />}
        </button>
      </li>
    );
  };

  return (
    <nav aria-label={t("Main")} className="relative z-10 flex w-[220px] shrink-0 flex-col border-r border-border bg-sidebar px-2.5 pt-12 pb-3">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-12" />
      <div className="mb-5 px-2">
        <Wordmark size={24} />
      </div>
      <ul className="flex flex-col gap-0.5">
        {row(MAIN[0])}
        {project &&
          row(
            { view: "player", label: project.project.title, icon: AudioLines, shortcut: "goPlayer", tip: `${t("Player")} · ${project.project.title}`, raw: true },
            true,
          )}
        {MAIN.slice(1).map((i) => row(i))}
      </ul>
      <div className="mt-5 mb-1.5 px-2.5 text-[11px] font-semibold text-muted">{t("More")}</div>
      <ul className="flex flex-col gap-0.5">{MORE.map((i) => row(i))}</ul>

      <div className="mt-auto flex flex-col gap-3 px-1">
        <MasterVolume />
        <Segmented<Theme>
          label={t("Appearance")}
          size="sm"
          full
          value={theme}
          onChange={(v) => void update({ theme: v })}
          options={[
            { value: "system", label: <Monitor size={13} />, aria: t("Match system"), tip: t("Match the system appearance") },
            { value: "light", label: <Sun size={13} />, aria: "Light", tip: mark("Light appearance"), shortcut: "toggleTheme" },
            { value: "dark", label: <Moon size={13} />, aria: "Dark", tip: mark("Dark appearance"), shortcut: "toggleTheme" },
          ]}
        />
        <p className="px-1.5 text-[11px] leading-relaxed text-faint">{t("Runs entirely on {computer}. Your audio never leaves it.", { computer: t(thisComputer) })}</p>
      </div>
    </nav>
  );
}

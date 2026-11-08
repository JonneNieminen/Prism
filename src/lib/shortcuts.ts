// Every keyboard shortcut, in one place. Used by the key handler, tooltips and
// the Shortcuts screen. Keys are written once with platform-neutral modifier tokens
// ("mod" = ⌘ on macOS, Ctrl on Windows and Linux) and rendered per OS. The native menu
// (src-tauri/src/menu.rs) mirrors the "mod" ones with CmdOrCtrl — keep both in sync
// (and the README table).

import { mark } from "../i18n";
import { isMac, platform, type Platform } from "./platform";

export type CommandId =
  | "open"
  | "separate"
  | "cancel"
  | "exportMix"
  | "exportStem"
  | "exportStems"
  | "goSeparate"
  | "goPlayer"
  | "goLibrary"
  | "goModels"
  | "goAnalyze"
  | "goDownload"
  | "goSettings"
  | "goHelp"
  | "goShortcuts"
  | "toggleTheme"
  | "masterUp"
  | "masterDown"
  | "masterMute"
  | "playPause"
  | "seekBack"
  | "seekForward"
  | "seekBackLong"
  | "seekForwardLong"
  | "toStart"
  | "loopToggle"
  | "loopIn"
  | "loopOut"
  | "karaoke"
  | "acapella"
  | "noGuitar"
  | "resetMix"
  | "minimize"
  | "fullscreen"
  | "hide"
  | "quit"
  | "closeDialog";

export type Group = "General" | "Navigation" | "Master volume" | "Player" | "Stems" | "Window";

export type Shortcut = {
  id: CommandId | "muteStem" | "soloStem";
  label: string;
  /** Platform-neutral tokens: "mod", "shift", "alt", "ctrl", or a literal key. */
  keys: string[];
  group: Group;
  /** Handled by the OS itself / the native menu only (not by the page). */
  systemOnly?: boolean;
  /** Only shown (and active) on these platforms. Default: all. */
  platforms?: Platform[];
};

const ALL_SHORTCUTS: Shortcut[] = [
  { id: "open", label: mark("Open a song…"), keys: ["mod", "O"], group: "General" },
  { id: "separate", label: mark("Start separation"), keys: ["mod", "↩"], group: "General" },
  { id: "cancel", label: mark("Cancel separation"), keys: ["mod", "."], group: "General" },
  { id: "exportMix", label: mark("Export current mix…"), keys: ["mod", "E"], group: "General" },
  { id: "exportStems", label: mark("Export all stems (.zip)…"), keys: ["shift", "mod", "E"], group: "General" },
  { id: "toggleTheme", label: mark("Switch light / dark appearance"), keys: ["shift", "mod", "L"], group: "General" },
  { id: "goShortcuts", label: mark("Show keyboard shortcuts"), keys: ["mod", "/"], group: "General" },
  { id: "goHelp", label: mark("Open Prism Help"), keys: ["shift", "mod", "/"], group: "General" },
  { id: "closeDialog", label: mark("Close dialog"), keys: ["esc"], group: "General" },

  { id: "goSeparate", label: mark("Separate"), keys: ["mod", "1"], group: "Navigation" },
  { id: "goPlayer", label: mark("Player (open song)"), keys: ["mod", "2"], group: "Navigation" },
  { id: "goLibrary", label: mark("Library"), keys: ["mod", "3"], group: "Navigation" },
  { id: "goModels", label: mark("Models"), keys: ["mod", "4"], group: "Navigation" },
  { id: "goAnalyze", label: mark("Key & BPM"), keys: ["mod", "5"], group: "Navigation" },
  { id: "goDownload", label: mark("Download track"), keys: ["mod", "6"], group: "Navigation" },
  { id: "goSettings", label: mark("Settings"), keys: ["mod", ","], group: "Navigation" },

  { id: "masterUp", label: mark("Master volume up"), keys: ["mod", "↑"], group: "Master volume" },
  { id: "masterDown", label: mark("Master volume down"), keys: ["mod", "↓"], group: "Master volume" },
  { id: "masterMute", label: mark("Mute / unmute master"), keys: ["M"], group: "Master volume" },

  { id: "playPause", label: mark("Play / pause"), keys: ["space"], group: "Player" },
  { id: "seekBack", label: mark("Back 5 seconds"), keys: ["←"], group: "Player" },
  { id: "seekForward", label: mark("Forward 5 seconds"), keys: ["→"], group: "Player" },
  { id: "seekBackLong", label: mark("Back 15 seconds"), keys: ["shift", "←"], group: "Player" },
  { id: "seekForwardLong", label: mark("Forward 15 seconds"), keys: ["shift", "→"], group: "Player" },
  { id: "toStart", label: mark("Go to start"), keys: ["0"], group: "Player" },
  { id: "loopIn", label: mark("Loop from here (set start)"), keys: ["I"], group: "Player" },
  { id: "loopOut", label: mark("Loop up to here (set end)"), keys: ["O"], group: "Player" },
  { id: "loopToggle", label: mark("Loop on / off"), keys: ["L"], group: "Player" },

  { id: "muteStem", label: mark("Mute / unmute stem 1–9"), keys: ["1", "–", "9"], group: "Stems" },
  { id: "soloStem", label: mark("Solo stem 1–9"), keys: ["shift", "1", "–", "9"], group: "Stems" },
  { id: "karaoke", label: mark("Karaoke (remove vocals)"), keys: ["K"], group: "Stems" },
  { id: "acapella", label: mark("A cappella (vocals only)"), keys: ["A"], group: "Stems" },
  { id: "noGuitar", label: mark("No guitar (remove the guitar stem)"), keys: ["G"], group: "Stems" },
  { id: "resetMix", label: mark("Reset mix"), keys: ["R"], group: "Stems" },

  { id: "minimize", label: mark("Minimize window"), keys: ["mod", "M"], group: "Window", systemOnly: true, platforms: ["mac"] },
  { id: "fullscreen", label: mark("Enter / exit full screen"), keys: ["ctrl", "mod", "F"], group: "Window", systemOnly: true, platforms: ["mac"] },
  { id: "fullscreen", label: mark("Enter / exit full screen"), keys: ["F11"], group: "Window", platforms: ["windows", "linux"] },
  { id: "hide", label: mark("Hide Prism"), keys: ["mod", "H"], group: "Window", systemOnly: true, platforms: ["mac"] },
  { id: "quit", label: mark("Quit Prism"), keys: ["mod", "Q"], group: "Window", systemOnly: true, platforms: ["mac", "linux"] },
  { id: "quit", label: mark("Quit Prism"), keys: ["alt", "F4"], group: "Window", systemOnly: true, platforms: ["windows"] },
];

/** The shortcuts that exist on this OS. */
export const SHORTCUTS: Shortcut[] = ALL_SHORTCUTS.filter((s) => !s.platforms || s.platforms.includes(platform));

const MAC_SYMBOL: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };
const OTHER_NAME: Record<string, string> = { mod: "Ctrl", ctrl: "Ctrl", shift: "Shift", alt: "Alt" };
// Display order of modifiers: macOS writes ⌃⌥⇧⌘, Windows and Linux write Ctrl+Alt+Shift.
const MAC_ORDER = ["ctrl", "alt", "shift", "mod"];
const OTHER_ORDER = ["mod", "ctrl", "alt", "shift"];

/** Keycaps for display on this OS, e.g. ["⇧", "⌘", "E"] or ["Ctrl", "Shift", "E"]. */
export function capsOf(keys: string[]): string[] {
  const order = isMac ? MAC_ORDER : OTHER_ORDER;
  const mods = keys.filter((k) => order.includes(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const rest = keys.filter((k) => !order.includes(k));
  const label = (k: string) => (isMac ? MAC_SYMBOL[k] : OTHER_NAME[k]);
  const literal = (k: string) => (!isMac && k === "↩" ? "Enter" : k);
  return [...mods.map(label), ...rest.map(literal)];
}

/** One-line form for tooltips and prose: "⇧⌘E" on macOS, "Ctrl+Shift+E" elsewhere. */
export function formatKeys(keys: string[]): string {
  const caps = capsOf(keys).map((k) => (k.length > 1 && /^[a-z]/.test(k) ? k[0].toUpperCase() + k.slice(1) : k));
  if (!isMac) return caps.join("+");
  return caps.join(caps.some((k) => k.length > 1 && /^[A-Za-z]/.test(k)) ? " " : "");
}

/** Compact keycap string for tooltips. */
export function keysFor(id: string): string | undefined {
  const s = SHORTCUTS.find((x) => x.id === id);
  return s ? formatKeys(s.keys) : undefined;
}

/** True when the platform's command modifier is held: ⌘ on macOS, Ctrl elsewhere. */
export function hasMod(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** Map a keyboard event to a command (page-level handling). */
export function matchEvent(e: KeyboardEvent): { id: CommandId } | { id: "muteStem" | "soloStem"; index: number } | null {
  const cmd = hasMod(e);
  const k = e.key.toLowerCase();
  if (!isMac && e.key === "F11" && !cmd && !e.altKey && !e.shiftKey) return { id: "fullscreen" };
  if (platform === "linux" && cmd && !e.altKey && !e.shiftKey && k === "q") return { id: "quit" };
  // Ctrl on macOS and ⌘ on Windows/Linux are other modifiers: never treat them as commands.
  if (isMac ? e.ctrlKey : e.metaKey) return null;
  if (cmd && !e.altKey) {
    if (e.key === "ArrowUp" && !e.shiftKey) return { id: "masterUp" };
    if (e.key === "ArrowDown" && !e.shiftKey) return { id: "masterDown" };
    if (k === "o" && !e.shiftKey) return { id: "open" };
    if (k === "enter") return { id: "separate" };
    if (k === "." || e.code === "Period") return { id: "cancel" };
    if (k === "e") return { id: e.shiftKey ? "exportStems" : "exportMix" };
    if (k === "l" && e.shiftKey) return { id: "toggleTheme" };
    if (e.code === "Slash") return { id: e.shiftKey ? "goHelp" : "goShortcuts" };
    if (k === "," || e.code === "Comma") return { id: "goSettings" };
    const nav = ["goSeparate", "goPlayer", "goLibrary", "goModels", "goAnalyze", "goDownload"] as const;
    const d = /^Digit([1-6])$/.exec(e.code);
    if (d && !e.shiftKey) return { id: nav[Number(d[1]) - 1] };
    return null;
  }
  if (e.altKey || e.metaKey || e.ctrlKey) return null;
  if (k === "m" && !e.shiftKey) return { id: "masterMute" };
  if (e.code === "Space") return { id: "playPause" };
  if (e.key === "ArrowLeft") return { id: e.shiftKey ? "seekBackLong" : "seekBack" };
  if (e.key === "ArrowRight") return { id: e.shiftKey ? "seekForwardLong" : "seekForward" };
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) {
    const n = Number(digit[1]);
    if (n === 0) return e.shiftKey ? null : { id: "toStart" };
    return { id: e.shiftKey ? "soloStem" : "muteStem", index: n - 1 };
  }
  if (e.shiftKey) return null;
  if (k === "k") return { id: "karaoke" };
  if (k === "a") return { id: "acapella" };
  if (k === "g") return { id: "noGuitar" };
  if (k === "r") return { id: "resetMix" };
  if (k === "i") return { id: "loopIn" };
  if (k === "o") return { id: "loopOut" };
  if (k === "l") return { id: "loopToggle" };
  return null;
}

// Every keyboard shortcut, in one place. Used by the key handler, tooltips and
// the Shortcuts screen. The native macOS menu (src-tauri/src/menu.rs) mirrors
// the ⌘ ones — keep both in sync (and the README table).

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
  | "goSettings"
  | "goHelp"
  | "goShortcuts"
  | "toggleTheme"
  | "playPause"
  | "seekBack"
  | "seekForward"
  | "seekBackLong"
  | "seekForwardLong"
  | "toStart"
  | "karaoke"
  | "acapella"
  | "resetMix"
  | "minimize"
  | "fullscreen"
  | "hide"
  | "quit"
  | "closeDialog";

export type Group = "General" | "Navigation" | "Player" | "Stems" | "Window";

export type Shortcut = {
  id: CommandId | "muteStem" | "soloStem";
  label: string;
  keys: string[]; // keycaps as displayed
  group: Group;
  /** Handled by macOS itself / the native menu only (not by the page). */
  systemOnly?: boolean;
};

export const SHORTCUTS: Shortcut[] = [
  { id: "open", label: "Open a song…", keys: ["⌘", "O"], group: "General" },
  { id: "separate", label: "Start separation", keys: ["⌘", "↩"], group: "General" },
  { id: "cancel", label: "Cancel separation", keys: ["⌘", "."], group: "General" },
  { id: "exportMix", label: "Export current mix…", keys: ["⌘", "E"], group: "General" },
  { id: "exportStems", label: "Export all stems (.zip)…", keys: ["⇧", "⌘", "E"], group: "General" },
  { id: "toggleTheme", label: "Switch light / dark appearance", keys: ["⇧", "⌘", "L"], group: "General" },
  { id: "goShortcuts", label: "Show keyboard shortcuts", keys: ["⌘", "/"], group: "General" },
  { id: "goHelp", label: "Open Prism Help", keys: ["⇧", "⌘", "/"], group: "General" },
  { id: "closeDialog", label: "Close dialog", keys: ["esc"], group: "General" },

  { id: "goSeparate", label: "Separate", keys: ["⌘", "1"], group: "Navigation" },
  { id: "goPlayer", label: "Player (open song)", keys: ["⌘", "2"], group: "Navigation" },
  { id: "goLibrary", label: "Library", keys: ["⌘", "3"], group: "Navigation" },
  { id: "goModels", label: "Models", keys: ["⌘", "4"], group: "Navigation" },
  { id: "goSettings", label: "Settings", keys: ["⌘", ","], group: "Navigation" },

  { id: "playPause", label: "Play / pause", keys: ["space"], group: "Player" },
  { id: "seekBack", label: "Back 5 seconds", keys: ["←"], group: "Player" },
  { id: "seekForward", label: "Forward 5 seconds", keys: ["→"], group: "Player" },
  { id: "seekBackLong", label: "Back 15 seconds", keys: ["⇧", "←"], group: "Player" },
  { id: "seekForwardLong", label: "Forward 15 seconds", keys: ["⇧", "→"], group: "Player" },
  { id: "toStart", label: "Go to start", keys: ["0"], group: "Player" },

  { id: "muteStem", label: "Mute / unmute stem 1–9", keys: ["1", "–", "9"], group: "Stems" },
  { id: "soloStem", label: "Solo stem 1–9", keys: ["⇧", "1", "–", "9"], group: "Stems" },
  { id: "karaoke", label: "Karaoke (remove vocals)", keys: ["K"], group: "Stems" },
  { id: "acapella", label: "A cappella (vocals only)", keys: ["A"], group: "Stems" },
  { id: "resetMix", label: "Reset mix", keys: ["R"], group: "Stems" },

  { id: "minimize", label: "Minimize window", keys: ["⌘", "M"], group: "Window", systemOnly: true },
  { id: "fullscreen", label: "Enter / exit full screen", keys: ["⌃", "⌘", "F"], group: "Window", systemOnly: true },
  { id: "hide", label: "Hide Prism", keys: ["⌘", "H"], group: "Window", systemOnly: true },
  { id: "quit", label: "Quit Prism", keys: ["⌘", "Q"], group: "Window", systemOnly: true },
];

/** Compact keycap string for tooltips, e.g. "⇧⌘E". */
export function keysFor(id: string): string | undefined {
  const s = SHORTCUTS.find((x) => x.id === id);
  if (!s) return undefined;
  const word = (k: string) => k.length > 1;
  const caps = s.keys.map((k) => (word(k) ? k[0].toUpperCase() + k.slice(1) : k));
  return caps.join(s.keys.some(word) ? " " : "");
}

/** Map a keyboard event to a command (page-level handling). */
export function matchEvent(e: KeyboardEvent): { id: CommandId } | { id: "muteStem" | "soloStem"; index: number } | null {
  const cmd = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (cmd && !e.altKey) {
    if (k === "o" && !e.shiftKey) return { id: "open" };
    if (k === "enter") return { id: "separate" };
    if (k === ".") return { id: "cancel" };
    if (k === "e") return { id: e.shiftKey ? "exportStems" : "exportMix" };
    if (k === "l" && e.shiftKey) return { id: "toggleTheme" };
    if (e.code === "Slash") return { id: e.shiftKey ? "goHelp" : "goShortcuts" };
    if (k === ",") return { id: "goSettings" };
    const nav = ["goSeparate", "goPlayer", "goLibrary", "goModels"] as const;
    const d = /^Digit([1-4])$/.exec(e.code);
    if (d && !e.shiftKey) return { id: nav[Number(d[1]) - 1] };
    return null;
  }
  if (e.altKey || e.metaKey || e.ctrlKey) return null;
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
  if (k === "r") return { id: "resetMix" };
  return null;
}

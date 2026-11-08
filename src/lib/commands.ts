// Runs a command from any source: keyboard, native menu, buttons.
import { usePlayer } from "../features/player/playerStore";
import { STEP, useMaster } from "./audio/master";
import { useApp } from "../store/app";
import { backend, isTauri } from "./ipc";
import type { CommandId } from "./shortcuts";

const lastRun = new Map<string, number>();

export async function runCommand(id: CommandId | "muteStem" | "soloStem", index = 0) {
  // The native menu and the page can both see the same keystroke; run once.
  const key = `${id}:${index}`;
  const now = performance.now();
  if (now - (lastRun.get(key) ?? 0) < 200) return;
  lastRun.set(key, now);

  const app = useApp.getState();
  const player = usePlayer.getState();
  const inPlayer = app.view === "player" && !!app.project;
  switch (id) {
    case "open":
      if (app.view === "analyze") return app.pickAnalysis();
      if (!app.job) return app.pickSource();
      return;
    case "separate": {
      const m = app.settings?.activeModelId;
      if (app.source && !app.job && m) {
        app.go("separate");
        return app.separate(m, app.settings!.quality);
      }
      return;
    }
    case "cancel":
      return app.cancelJob();
    case "exportMix":
      if (app.project) {
        app.go("player");
        app.setExportTarget({ kind: "mix" });
      }
      return;
    case "exportStems":
      if (app.project) {
        app.go("player");
        app.setExportTarget({ kind: "zip" });
      }
      return;
    case "exportStem":
      return;
    case "goSeparate":
      return app.go("separate");
    case "goPlayer":
      return app.project ? app.go("player") : undefined;
    case "goLibrary":
      return app.go("library");
    case "goAnalyze":
      return app.go("analyze");
    case "goModels":
      return app.go("models");
    case "goSettings":
      return app.go("settings");
    case "goHelp":
      return app.go("help");
    case "goShortcuts":
      return app.go("shortcuts");
    case "toggleTheme": {
      const dark = document.documentElement.dataset.theme === "dark";
      return app.updateSettings({ theme: dark ? "light" : "dark" });
    }
    case "masterUp":
      return useMaster.getState().nudge(STEP);
    case "masterDown":
      return useMaster.getState().nudge(-STEP);
    case "masterMute":
      return useMaster.getState().toggleMute();
    case "playPause":
      return inPlayer ? player.engine?.toggle() : undefined;
    case "seekBack":
      return inPlayer ? player.seekBy(-5) : undefined;
    case "seekForward":
      return inPlayer ? player.seekBy(5) : undefined;
    case "seekBackLong":
      return inPlayer ? player.seekBy(-15) : undefined;
    case "seekForwardLong":
      return inPlayer ? player.seekBy(15) : undefined;
    case "toStart":
      return inPlayer ? player.engine?.seek(0) : undefined;
    case "karaoke":
      return inPlayer ? player.preset("karaoke") : undefined;
    case "acapella":
      return inPlayer ? player.preset("acapella") : undefined;
    case "resetMix":
      return inPlayer ? player.preset("reset") : undefined;
    case "muteStem":
    case "soloStem": {
      const m = player.mix[index];
      if (!inPlayer || !m) return;
      return player.setStem(m.id, id === "soloStem" ? { solo: !m.solo } : { muted: !m.muted });
    }
    case "minimize":
    case "fullscreen":
    case "hide":
    case "quit":
      return isTauri ? (await backend()).windowAction(id) : undefined;
    case "closeDialog":
      return;
  }
}

import { Volume1, Volume2, VolumeX } from "lucide-react";
import { masterGain, useMaster } from "../lib/audio/master";
import { cx, tipAttrs } from "./ui";
import { useT } from "../i18n/useT";

/** App-wide playback level: a slider and an on/off switch, always one glance away. */
export function MasterVolume() {
  const { t } = useT();
  const volume = useMaster((s) => s.volume);
  const muted = useMaster((s) => s.muted);
  const setVolume = useMaster((s) => s.setVolume);
  const toggleMute = useMaster((s) => s.toggleMute);
  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : masterGain(volume, false) < 0.25 ? Volume1 : Volume2;
  const shown = Math.round(volume * 100);

  return (
    <div role="group" aria-label={t("Master volume")} className="px-1">
      <div className="mb-1 flex items-center justify-between px-1.5">
        <span className="text-[11px] font-semibold text-muted">{t("Master volume")}</span>
        <span className={cx("tabular text-[11px]", silent ? "text-accent" : "text-muted")}>{muted ? t("Muted") : `${shown}%`}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          role="switch"
          aria-checked={!muted}
          aria-label={t("Sound")}
          onClick={toggleMute}
          {...tipAttrs({ tip: muted ? t("Sound is off. Click to turn it on") : t("Sound is on. Click to mute everything"), shortcut: "masterMute" })}
          className={cx(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-elevated",
            silent ? "text-accent" : "text-muted hover:text-text",
          )}
        >
          <Icon size={15} />
        </button>
        <input
          type="range"
          className="prism-range min-w-0 flex-1"
          aria-label={t("Master volume")}
          aria-valuetext={`${shown}%`}
          {...tipAttrs({ tip: t("Master volume for everything Prism plays · double-click to reset"), shortcut: "masterUp" })}
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          onDoubleClick={() => setVolume(1)}
          style={{ ["--fill" as string]: `${volume * 100}%`, opacity: muted ? 0.45 : 1 }}
        />
      </div>
    </div>
  );
}

import { motion } from "motion/react";
import { Archive, Download, Headphones, MicOff, Pause, Play, Repeat, RotateCcw, Share, SkipBack, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectStem } from "../../bindings";
import { Waveform } from "../../components/Waveform";
import { Button, Chip, IconButton, Kbd, Keys, PageHeader, cx } from "../../components/ui";
import { MIN_LOOP } from "../../lib/audio/engine";
import { runCommand } from "../../lib/commands";
import { stemColor, withAlpha } from "../../lib/colors";
import { capsOf, formatKeys } from "../../lib/shortcuts";
import { formatBpm, formatKeyName, formatTime, qualityLabel, stemLabel } from "../../lib/format";
import { useApp } from "../../store/app";
import { ExportDialog } from "../export/ExportDialog";
import { usePlayer } from "./playerStore";
import { useT } from "../../i18n/useT";

/** Width of the left controls column in each stem row (keeps the playhead aligned). */
const CONTROLS_W = 236;

export function PlayerView({ theme }: { theme: string }) {
  const { t } = useT();
  const open = useApp((s) => s.project)!;
  const setExportTarget = useApp((s) => s.setExportTarget);
  const ensureMusic = useApp((s) => s.ensureMusic);
  const detected = useApp((s) => s.music[open.project.id]);
  const { project, peaks } = open;
  const music = project.music ?? detected;
  const load = usePlayer((s) => s.load);
  const engine = usePlayer((s) => s.engine);
  const loading = usePlayer((s) => s.loading);
  const error = usePlayer((s) => s.error);
  const playing = usePlayer((s) => s.playing);
  const mix = usePlayer((s) => s.mix);
  const setStem = usePlayer((s) => s.setStem);
  const setAll = usePlayer((s) => s.setAll);
  const preset = usePlayer((s) => s.preset);
  const loop = usePlayer((s) => s.loop);
  const loopOn = usePlayer((s) => s.loopOn);
  const setLoop = usePlayer((s) => s.setLoop);
  const setLoopDraft = usePlayer((s) => s.setLoopDraft);
  const [hovered, setHovered] = useState<string | null>(null);
  const ready = loading >= 1 && !!engine;

  useEffect(() => load(open), [open, load]);
  // Projects saved before key/tempo detection get it the first time they are opened.
  useEffect(() => void ensureMusic(open.project), [open.project, ensureMusic]);

  // Imperative playhead: one rAF loop updates every progress layer, no React renders.
  const progressRefs = useRef(new Map<string, React.RefObject<HTMLDivElement | null>>());
  const refFor = (id: string) => {
    let r = progressRefs.current.get(id);
    if (!r) progressRefs.current.set(id, (r = { current: null }));
    return r;
  };
  const headRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    const tick = () => {
      const t = engine.currentTime;
      const pct = engine.duration ? (t / engine.duration) * 100 : 0;
      progressRefs.current.forEach((r) => r.current && (r.current.style.width = `${pct}%`));
      if (headRef.current) headRef.current.style.left = `${pct}%`;
      if (timeRef.current) timeRef.current.textContent = formatTime(t);
      if (seekRef.current && document.activeElement !== seekRef.current) {
        seekRef.current.value = String(t);
        seekRef.current.style.setProperty("--fill", `${pct}%`);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [engine, ready]);

  const anySolo = mix.some((m) => m.solo);
  const hasVocals = project.stems.some((s) => s.id === "vocals");
  const isKaraoke = hasVocals && mix.some((m) => m.id === "vocals" && m.muted) && !anySolo && mix.filter((m) => m.id !== "vocals").every((m) => !m.muted);
  const isAcapella = hasVocals && mix.some((m) => m.id === "vocals" && m.solo) && mix.filter((m) => m.solo).length === 1;
  const audibleCount = mix.filter((m) => (anySolo ? m.solo : !m.muted)).length;

  // Click or drag on any waveform to scrub. The pointer is captured so the drag keeps
  // working outside the lane, and the audio only restarts once, on release.
  // Shift-drag selects a loop region instead.
  const scrubbing = useRef(false);
  const loopAnchor = useRef<number | null>(null);
  const timeAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (engine?.duration ?? 0);
  };
  const scrubStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!engine?.duration || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.shiftKey) {
      const t = timeAt(e);
      loopAnchor.current = t;
      setLoopDraft({ start: t, end: t });
      return;
    }
    scrubbing.current = true;
    engine.beginScrub();
    engine.scrubTo(timeAt(e));
  };
  const scrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (loopAnchor.current !== null) {
      const a = loopAnchor.current;
      const t = timeAt(e);
      setLoopDraft({ start: Math.min(a, t), end: Math.max(a, t) });
    } else if (scrubbing.current) engine?.scrubTo(timeAt(e));
  };
  const scrubEnd = () => {
    if (loopAnchor.current !== null) {
      loopAnchor.current = null;
      const draft = usePlayer.getState().loopDraft;
      if (draft && draft.end - draft.start >= MIN_LOOP) {
        setLoop(draft, true);
        engine?.seek(draft.start);
      } else setLoopDraft(null);
      return;
    }
    if (!scrubbing.current) return;
    scrubbing.current = false;
    engine?.endScrub();
  };

  // Click a channel to mute / unmute it. Shift-click applies the new state to every
  // channel between the last one clicked and this one.
  const lastClicked = useRef<number | null>(null);
  const toggleMute = (index: number, shiftKey: boolean) => {
    const next = !(mix.find((x) => x.id === project.stems[index].id)?.muted ?? false);
    const from = shiftKey && lastClicked.current !== null ? Math.min(lastClicked.current, index) : index;
    const to = shiftKey && lastClicked.current !== null ? Math.max(lastClicked.current, index) : index;
    const ids = new Set(project.stems.slice(from, to + 1).map((s) => s.id));
    setAll((m) => (ids.has(m.id) ? { muted: next } : {}));
    lastClicked.current = index;
  };

  return (
    <div className="mx-auto max-w-[1080px] py-8">
      <PageHeader
        title={project.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            {project.artist && <span>{project.artist} ·</span>}
            <span className="tabular">{formatTime(project.durationSecs)}</span>
            {music?.bpm != null && (
              <Chip color="var(--accent)" tip={music.bpmConfidence < 0.4 ? t("Estimated tempo of the original mix (low confidence). It can land on half or double time.") : t("Estimated tempo of the original mix. It can land on half or double time.")}>
                {formatBpm(music.bpm)}
              </Chip>
            )}
            {music?.key && (
              <Chip color="var(--accent)" tip={(music.key.confidence < 0.25 ? t("Estimated key of the original mix (low confidence; the relative major or minor is close)") : t("Estimated key of the original mix")) + ` · Camelot ${music.key.camelot}`}>
                {formatKeyName(music.key.name)} · {music.key.camelot}
              </Chip>
            )}
            <span>·</span>
            <Chip tip={t("The model that made these stems")}>{project.model.name}</Chip>
            <Chip tip={t("Quality setting used")}>{qualityLabel(project.quality)}</Chip>
            <span className="text-[12px] text-faint">
              {t("Separated in {secs} s on {device}", { secs: Math.round(project.processingSecs), device: project.device })}
            </span>
          </span>
        }
        right={
          <div className="flex gap-2">
            <Button icon={<Archive size={14} />} onClick={() => setExportTarget({ kind: "zip" })} tip={t("Download every stem in one .zip")} shortcut="exportStems">
              {t("Download all stems")}
            </Button>
            <Button variant="primary" icon={<Share size={14} />} onClick={() => setExportTarget({ kind: "mix" })} disabled={audibleCount === 0} tip={t("Save what you hear as one file")} shortcut="exportMix">
              {t("Export mix")}
            </Button>
          </div>
        }
      />

      {/* Transport */}
      <div className="card mb-4 flex items-center gap-4 px-4 py-3">
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => void engine?.toggle()}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          data-tip={playing ? "Pause" : "Play"}
          data-shortcut="playPause"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
        </motion.button>
        <button
          aria-label={t("Go to start")}
          data-tip={t("Go to start")}
          data-shortcut="toStart"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-text"
          onClick={() => engine?.seek(0)}
          disabled={!ready}
        >
          <SkipBack size={15} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span ref={timeRef} className="tabular w-10 text-right text-[12px]">
            0:00
          </span>
          <input
            ref={seekRef}
            type="range"
            className="prism-range min-w-0 flex-1"
            aria-label={t("Playback position")}
            data-tip={t("Drag to move through the song (← → skip 5 s)")}
            min={0}
            max={engine?.duration || project.durationSecs}
            step={0.01}
            defaultValue={0}
            disabled={!ready}
            onPointerDown={() => engine?.beginScrub()}
            onPointerUp={() => engine?.endScrub()}
            onPointerCancel={() => engine?.endScrub()}
            onChange={(e) => {
              engine?.scrubTo(Number(e.target.value));
              e.target.style.setProperty("--fill", `${(Number(e.target.value) / (engine?.duration || 1)) * 100}%`);
            }}
          />
          <span className="tabular w-10 text-[12px] text-muted">{formatTime(engine?.duration || project.durationSecs)}</span>
        </div>
        <div className="flex items-center gap-0.5 border-l border-border pl-4">
          <Button
            size="sm"
            variant={loopOn ? "secondary" : "ghost"}
            icon={<Repeat size={13} />}
            aria-pressed={loopOn}
            onClick={() => void runCommand("loopToggle")}
            disabled={!ready}
            tip={loop ? (loopOn ? t("Stop looping") : t("Loop this part again")) : t("Loop a part: shift-drag across a waveform, or press I and O at its start and end")}
            shortcut="loopToggle"
          >
            {loop ? <span className="tabular">{`${formatTime(loop.start)}–${formatTime(loop.end)}`}</span> : <span className="max-xl:sr-only">{t("Loop")}</span>}
          </Button>
          {loop && (
            <IconButton label={t("Clear loop")} tip={t("Clear the loop")} onClick={() => setLoop(null)}>
              <X size={13} />
            </IconButton>
          )}
        </div>
        {hasVocals && (
          <div className="flex items-center gap-1 border-l border-border pl-4">
            <Button size="sm" variant={isKaraoke ? "secondary" : "ghost"} icon={<MicOff size={13} />} aria-pressed={isKaraoke} onClick={() => preset("karaoke")} tip={t("Remove the vocals")} shortcut="karaoke">
              <span className="max-xl:sr-only">{t("Karaoke")}</span>
            </Button>
            <Button size="sm" variant={isAcapella ? "secondary" : "ghost"} icon={<Headphones size={13} />} aria-pressed={isAcapella} onClick={() => preset("acapella")} tip={t("Hear only the vocals")} shortcut="acapella">
              <span className="max-xl:sr-only">{t("A cappella")}</span>
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => preset("reset")} tip={t("Unmute everything, volumes to 100%")} shortcut="resetMix">
              <span className="max-xl:sr-only">{t("Reset")}</span>
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-xl border border-border bg-surface p-3.5 text-[13px] text-danger">
          {t("Couldn't load the stems for playback:")} {error}
        </div>
      )}

      {/* Stems */}
      <div className="card relative overflow-hidden" onMouseLeave={() => setHovered(null)}>
        {project.stems.map((s, i) => {
          const m = mix.find((x) => x.id === s.id) ?? { id: s.id, muted: false, solo: false, volume: 1 };
          const audible = anySolo ? m.solo : !m.muted;
          return (
            <StemRow
              key={s.id}
              index={i}
              last={i === project.stems.length - 1}
              stem={s}
              peaks={peaks[s.id] ?? []}
              muted={m.muted}
              solo={m.solo}
              volume={m.volume}
              audible={audible}
              dimmed={(hovered !== null && hovered !== s.id) || !audible}
              highlighted={hovered === s.id}
              loading={!ready}
              theme={theme}
              progressRef={refFor(s.id)}
              onHover={() => setHovered(s.id)}
              onMute={(shiftKey) => toggleMute(i, shiftKey)}
              onSolo={() => setStem(s.id, { solo: !m.solo })}
              onVolume={(v) => setStem(s.id, { volume: v })}
              onScrubStart={scrubStart}
              onScrubMove={scrubMove}
              onScrubEnd={scrubEnd}
              onDownload={() => setExportTarget({ kind: "stem", stemId: s.id })}
            />
          );
        })}
        {/* shared loop region and playhead across all lanes */}
        <div className="pointer-events-none absolute inset-y-0 right-[96px]" style={{ left: CONTROLS_W + 16 }}>
          <LoopOverlay duration={engine?.duration || project.durationSecs} />
          <div ref={headRef} className="absolute inset-y-0 w-px bg-text/70" style={{ left: "0%" }} />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <Kbd>{t("Space")}</Kbd> {t("play / pause")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> {t("skip 5 s")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>1</Kbd>–<Kbd>{Math.min(9, project.stems.length)}</Kbd> {t("mute")}
        </span>
        <span className="flex items-center gap-1.5">
          <Keys keys={capsOf(["shift", "1"])} /> {t("solo")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>K</Kbd> {t("karaoke")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>I</Kbd>
          <Kbd>O</Kbd> {t("set loop")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>L</Kbd> {t("loop")}
        </span>
      </div>

      <ExportDialog project={project} mix={mix} />
    </div>
  );
}

function StemRow(props: {
  index: number;
  last: boolean;
  stem: ProjectStem;
  peaks: number[];
  muted: boolean;
  solo: boolean;
  volume: number;
  audible: boolean;
  dimmed: boolean;
  highlighted: boolean;
  loading: boolean;
  theme: string;
  progressRef: React.RefObject<HTMLDivElement | null>;
  onHover: () => void;
  onMute: (shiftKey: boolean) => void;
  onSolo: () => void;
  onVolume: (v: number) => void;
  onScrubStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  onScrubMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onScrubEnd: () => void;
  onDownload: () => void;
}) {
  const { stem, index } = props;
  const color = useMemo(() => stemColor(stem.id, stem.color), [stem.id, stem.color]);
  const VolIcon = !props.audible || props.volume === 0 ? VolumeX : props.volume < 0.5 ? Volume1 : Volume2;
  const n = index + 1;
  const { t } = useT();
  const name = stemLabel(stem.label);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut", delay: 0.04 * index }}
      onMouseEnter={props.onHover}
      onFocus={props.onHover}
      className={cx("group relative flex h-[76px] items-center gap-4 pr-3 transition-colors duration-150", !props.last && "border-b border-border")}
      style={{ background: props.highlighted ? withAlpha(color, 0.06) : undefined }}
    >
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color, opacity: props.audible ? 1 : 0.25 }} />
      {/* The whole label area is the mute toggle; the volume slider and solo button sit above it. */}
      <button
        aria-pressed={props.muted}
        aria-label={props.muted ? t("Unmute {name}", { name }) : t("Mute {name}", { name })}
        data-tip={(props.muted ? t("Unmute {name}", { name }) : t("Mute {name}", { name })) + ` · ${t("{keys}-click to change several", { keys: formatKeys(["shift"]) })}  ${n}`}
        onClick={(e) => props.onMute(e.shiftKey)}
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        className="absolute inset-y-0 left-[3px] cursor-pointer select-none hover:bg-elevated/50"
        style={{ width: CONTROLS_W + 13 }}
      />
      <div className="pointer-events-none relative flex shrink-0 items-center gap-3 pl-3" style={{ width: CONTROLS_W }}>
        {/* Mute dot: filled = playing, hollow = muted. No transition, so it flips with the sound. */}
        <button
          aria-pressed={props.muted}
          aria-label={props.muted ? t("Unmute {name}", { name }) : t("Mute {name}", { name })}
          data-tip={props.muted ? t("{name} is muted — click to unmute", { name }) : t("{name} is playing — click to mute", { name })}
          onClick={(e) => props.onMute(e.shiftKey)}
          onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          className="pointer-events-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-elevated"
        >
          <span className="block h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: color, background: props.muted ? "transparent" : color }} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cx("truncate text-[13px] font-medium", !props.audible && "text-muted")}>{name}</span>
            <span className="text-[11px] text-faint" data-tip={t("Press {n} to mute, {keys} to solo", { n, keys: formatKeys(["shift", String(n)]) })}>
              {n}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <VolIcon size={13} className="shrink-0 text-muted" />
            <input
              type="range"
              className="prism-range pointer-events-auto w-[92px]"
              aria-label={t("{name} volume", { name })}
              data-tip={t("{name} volume · double-click to reset", { name })}
              min={0}
              max={1.5}
              step={0.01}
              value={props.volume}
              onChange={(e) => props.onVolume(Number(e.target.value))}
              onDoubleClick={() => props.onVolume(1)}
              style={{ ["--fill" as string]: `${(props.volume / 1.5) * 100}%`, ["--accent-color" as string]: color }}
            />
            <span className="tabular w-8 text-[11px] text-muted">{Math.round(props.volume * 100)}%</span>
          </div>
        </div>
        <div className="pointer-events-auto flex gap-1">
          <ToggleChip label="S" tip={props.solo ? t("Stop soloing {name}", { name }) : t("Solo {name}", { name })} keys={formatKeys(["shift", String(n)])} on={props.solo} color={color} onClick={props.onSolo} />
        </div>
      </div>
      <div
        className="relative min-w-0 flex-1 cursor-pointer touch-none select-none"
        onPointerDown={props.onScrubStart}
        onPointerMove={props.onScrubMove}
        onPointerUp={props.onScrubEnd}
        onPointerCancel={props.onScrubEnd}
        data-tip={t("Click to jump here, drag to scrub · {keys}-drag to loop a part", { keys: formatKeys(["shift"]) })}
      >
        {/* Peaks come from the library, so the waveform shows instantly; audio decodes in the background. */}
        <div className={cx("transition-opacity duration-300", props.loading && "animate-pulse opacity-60")}>
          <Waveform peaks={props.peaks} color={color} height={52} progressRef={props.progressRef} dimmed={props.dimmed} theme={props.theme} />
        </div>
      </div>
      <button
        aria-label={t("Export {name}", { name })}
        data-tip={t("Export {name} only", { name })}
        onClick={props.onDownload}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-50 transition hover:bg-elevated hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Download size={15} />
      </button>
    </motion.div>
  );
}

/** The loop region, live while it is being shift-dragged. Dashed edges when looping is off. */
function LoopOverlay({ duration }: { duration: number }) {
  const draft = usePlayer((s) => s.loopDraft);
  const saved = usePlayer((s) => s.loop);
  const on = usePlayer((s) => s.loopOn) || draft !== null;
  const loop = draft ?? saved;
  if (!loop || !duration || loop.end <= loop.start) return null;
  const edge = `1px ${on ? "solid" : "dashed"} var(--accent)`;
  return (
    <div
      className="absolute inset-y-0"
      style={{
        left: `${(loop.start / duration) * 100}%`,
        width: `${((loop.end - loop.start) / duration) * 100}%`,
        background: on ? "var(--accent-soft)" : "transparent",
        borderLeft: edge,
        borderRight: edge,
      }}
    />
  );
}

function ToggleChip({ label, tip, keys, on, color, onClick }: { label: string; tip: string; keys: string; on: boolean; color: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={on}
      aria-label={tip}
      data-tip={`${tip}  ${keys}`}
      onClick={onClick}
      className="h-7 w-7 rounded-md text-[11px] font-semibold transition-colors"
      style={on ? { background: color, color: "var(--bg)" } : { background: "var(--elevated)", color: "var(--muted)" }}
    >
      {label}
    </button>
  );
}

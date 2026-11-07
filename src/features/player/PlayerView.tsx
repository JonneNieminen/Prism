import { motion } from "motion/react";
import { Download, Headphones, MicOff, Pause, Play, RotateCcw, Share, SkipBack, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectStem } from "../../bindings";
import { Waveform } from "../../components/Waveform";
import { Button, Card, Chip, Kbd, cx } from "../../components/ui";
import { stemColor, withAlpha } from "../../lib/colors";
import { formatTime, QUALITY_LABEL } from "../../lib/format";
import { useApp } from "../../store/app";
import { ExportDialog, type ExportTarget } from "../export/ExportDialog";
import { usePlayer } from "./playerStore";

export function PlayerView({ theme }: { theme: string }) {
  const open = useApp((s) => s.project)!;
  const { project, peaks } = open;
  const load = usePlayer((s) => s.load);
  const engine = usePlayer((s) => s.engine);
  const loading = usePlayer((s) => s.loading);
  const error = usePlayer((s) => s.error);
  const playing = usePlayer((s) => s.playing);
  const mix = usePlayer((s) => s.mix);
  const setStem = usePlayer((s) => s.setStem);
  const setAll = usePlayer((s) => s.setAll);
  const [hovered, setHovered] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null);
  const ready = loading >= 1 && !!engine;

  useEffect(() => load(open), [open, load]);

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

  const toggleStem = useCallback(
    (i: number, solo: boolean) => {
      const m = usePlayer.getState().mix[i];
      if (m) setStem(m.id, solo ? { solo: !m.solo } : { muted: !m.muted });
    },
    [setStem],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input[type=text], input:not([type]), textarea, [role=dialog], select")) return;
      // Space always plays/pauses, except on a control the user reached by keyboard
      // (there Space must activate the control).
      const keyboardFocusedControl = el.matches(":focus-visible") && !!el.closest("button, [role=radio], [role=switch], input");
      if (e.code === "Space" && !keyboardFocusedControl) {
        e.preventDefault();
        void engine?.toggle();
      } else if (e.key === "ArrowLeft" && !el.closest("input")) engine?.seek(engine.currentTime - 5);
      else if (e.key === "ArrowRight" && !el.closest("input")) engine?.seek(engine.currentTime + 5);
      else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) toggleStem(Number(e.key) - 1, e.shiftKey);
      else if (/^Digit[1-9]$/.test(e.code) && e.shiftKey) toggleStem(Number(e.code.slice(5)) - 1, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, toggleStem]);

  const anySolo = mix.some((m) => m.solo);
  const hasVocals = project.stems.some((s) => s.id === "vocals");
  const isKaraoke = hasVocals && mix.some((m) => m.id === "vocals" && m.muted) && !anySolo && mix.filter((m) => m.id !== "vocals").every((m) => !m.muted);
  const isAcapella = hasVocals && mix.some((m) => m.id === "vocals" && m.solo) && mix.filter((m) => m.solo).length === 1;
  const audibleCount = mix.filter((m) => (anySolo ? m.solo : !m.muted)).length;

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!engine?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    engine.seek(((e.clientX - r.left) / r.width) * engine.duration);
  };

  return (
    <div className="mx-auto max-w-[1100px] py-8">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[30px] font-semibold tracking-tight">{project.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
            {project.artist && <span>{project.artist} ·</span>}
            <span className="tabular">{formatTime(project.durationSecs)}</span>
            <span>·</span>
            <Chip>{project.model.name}</Chip>
            <Chip>{QUALITY_LABEL[project.quality]}</Chip>
            <span className="text-xs">
              Separated in {Math.round(project.processingSecs)} s on {project.device}
            </span>
          </div>
        </div>
        <Button variant="primary" icon={<Share size={16} />} onClick={() => setExportTarget({ kind: "mix" })} disabled={audibleCount === 0}>
          Export
        </Button>
      </div>

      {/* Transport */}
      <Card className="mb-5 flex items-center gap-5 p-4">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => void engine?.toggle()}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          className="brand-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-[0_10px_30px_-10px_var(--brand-to)] transition-[filter] hover:brightness-110 disabled:opacity-50"
        >
          {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
        </motion.button>
        <button aria-label="Back to start" className="text-muted hover:text-text" onClick={() => engine?.seek(0)} disabled={!ready}>
          <SkipBack size={18} />
        </button>
        <div className="flex flex-1 items-center gap-3">
          <span ref={timeRef} className="tabular w-11 text-right text-sm">
            0:00
          </span>
          <input
            ref={seekRef}
            type="range"
            className="prism-range flex-1"
            aria-label="Seek"
            min={0}
            max={engine?.duration || project.durationSecs}
            step={0.01}
            defaultValue={0}
            disabled={!ready}
            onChange={(e) => {
              engine?.seek(Number(e.target.value));
              e.target.style.setProperty("--fill", `${(Number(e.target.value) / (engine?.duration || 1)) * 100}%`);
            }}
            style={{ ["--accent" as string]: "var(--text)" }}
          />
          <span className="tabular w-11 text-sm text-muted">{formatTime(engine?.duration || project.durationSecs)}</span>
        </div>
        {hasVocals && (
          <div className="flex items-center gap-1.5 border-l border-hairline pl-5">
            <Button
              size="sm"
              variant={isKaraoke ? "secondary" : "ghost"}
              icon={<MicOff size={14} />}
              aria-pressed={isKaraoke}
              onClick={() => setAll((m) => ({ solo: false, muted: m.id === "vocals" }))}
            >
              Karaoke
            </Button>
            <Button
              size="sm"
              variant={isAcapella ? "secondary" : "ghost"}
              icon={<Headphones size={14} />}
              aria-pressed={isAcapella}
              onClick={() => setAll((m) => ({ muted: false, solo: m.id === "vocals" }))}
            >
              A cappella
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setAll(() => ({ muted: false, solo: false, volume: 1 }))}>
              Reset
            </Button>
          </div>
        )}
      </Card>

      {error && (
        <div role="alert" className="mb-4 rounded-2xl border border-[color-mix(in_oklab,var(--danger)_35%,transparent)] p-4 text-sm text-danger">
          Couldn't load the stems for playback: {error}
        </div>
      )}

      {/* Stems */}
      <div className="relative flex flex-col gap-2.5" onMouseLeave={() => setHovered(null)}>
        {project.stems.map((s, i) => {
          const m = mix.find((x) => x.id === s.id) ?? { id: s.id, muted: false, solo: false, volume: 1 };
          const audible = anySolo ? m.solo : !m.muted;
          return (
            <StemCard
              key={s.id}
              index={i}
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
              onMute={() => setStem(s.id, { muted: !m.muted })}
              onSolo={() => setStem(s.id, { solo: !m.solo })}
              onVolume={(v) => setStem(s.id, { volume: v })}
              onSeek={seekFromEvent}
              onDownload={() => setExportTarget({ kind: "stem", stemId: s.id })}
            />
          );
        })}
        {/* shared playhead across all lanes (waveform column) */}
        <div className="pointer-events-none absolute inset-y-0 right-[64px] left-[292px]">
          <div ref={headRef} className="absolute inset-y-1 w-px bg-text/80 shadow-[0_0_8px_var(--text)]" style={{ left: "0%" }} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <Kbd>Space</Kbd> play / pause
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> skip 5 s
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>1</Kbd>–<Kbd>{Math.min(9, project.stems.length)}</Kbd> mute
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>⇧</Kbd>+<Kbd>1</Kbd> solo
        </span>
      </div>

      <ExportDialog target={exportTarget} onClose={() => setExportTarget(null)} project={project} mix={mix} />
    </div>
  );
}

function StemCard(props: {
  index: number;
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
  onMute: () => void;
  onSolo: () => void;
  onVolume: (v: number) => void;
  onSeek: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDownload: () => void;
}) {
  const { stem, index } = props;
  const color = useMemo(() => stemColor(stem.id, stem.color), [stem.id, stem.color]);
  const VolIcon = !props.audible || props.volume === 0 ? VolumeX : props.volume < 0.5 ? Volume1 : Volume2;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.06 * index }}
      onMouseEnter={props.onHover}
      onFocus={props.onHover}
      className={cx("glass group relative flex h-[88px] items-center gap-4 overflow-hidden rounded-[18px] pr-3 pl-0 transition-[border-color,box-shadow] duration-200")}
      style={{
        borderColor: props.highlighted ? withAlpha(color, 0.55) : undefined,
        boxShadow: props.highlighted ? `0 0 0 1px ${withAlpha(color, 0.25)}, 0 10px 40px -12px ${withAlpha(color, 0.45)}` : undefined,
      }}
    >
      <div className="h-full w-1.5 shrink-0" style={{ background: color, opacity: props.audible ? 1 : 0.3 }} />
      <div className="flex w-[254px] shrink-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium" style={{ color: props.audible ? undefined : "var(--muted)" }}>
              {stem.label}
            </span>
            <span className="text-[11px] text-muted">{index + 1}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <VolIcon size={14} className="shrink-0 text-muted" />
            <input
              type="range"
              className="prism-range w-[110px]"
              aria-label={`${stem.label} volume`}
              min={0}
              max={1.5}
              step={0.01}
              value={props.volume}
              onChange={(e) => props.onVolume(Number(e.target.value))}
              onDoubleClick={() => props.onVolume(1)}
              style={{ ["--fill" as string]: `${(props.volume / 1.5) * 100}%`, ["--accent" as string]: color }}
            />
            <span className="tabular w-8 text-[11px] text-muted">{Math.round(props.volume * 100)}%</span>
          </div>
        </div>
        <div className="flex gap-1">
          <ToggleChip label="M" title={`${props.muted ? "Unmute" : "Mute"} ${stem.label}`} on={props.muted} color="var(--muted)" onClick={props.onMute} />
          <ToggleChip label="S" title={`${props.solo ? "Unsolo" : "Solo"} ${stem.label}`} on={props.solo} color={color} onClick={props.onSolo} />
        </div>
      </div>
      <div className="relative min-w-0 flex-1 cursor-pointer" onPointerDown={props.onSeek} aria-hidden>
        {props.loading ? (
          <div className="h-14 animate-pulse rounded-lg" style={{ background: withAlpha(color, 0.08) }} />
        ) : (
          <Waveform peaks={props.peaks} color={color} height={60} progressRef={props.progressRef} dimmed={props.dimmed} theme={props.theme} />
        )}
      </div>
      <button
        aria-label={`Download ${stem.label}`}
        title={`Download ${stem.label}`}
        onClick={props.onDownload}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted opacity-60 transition hover:bg-elevated hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Download size={17} />
      </button>
    </motion.div>
  );
}

function ToggleChip({ label, title, on, color, onClick }: { label: string; title: string; on: boolean; color: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={on}
      aria-label={title}
      title={title}
      onClick={onClick}
      className="h-8 w-8 rounded-lg border text-xs font-bold transition-colors"
      style={
        on
          ? { background: color, borderColor: color, color: "var(--bg)" }
          : { borderColor: "var(--hairline)", color: "var(--muted)" }
      }
    >
      {label}
    </button>
  );
}

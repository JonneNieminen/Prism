import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, FileAudio, FileWarning, MemoryStick, Music2, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppError, ModelInfo, Quality } from "../../bindings";
import { Waveform } from "../../components/Waveform";
import { Button, Card, Chip, IconButton, Meter, ProgressBar, Segmented, StemChip, cx } from "../../components/ui";
import { formatDate, formatEta, formatTime, QUALITY_LABEL } from "../../lib/format";
import { backend } from "../../lib/ipc";
import { stemColor } from "../../lib/colors";
import { useApp } from "../../store/app";
import { LicenseDialog } from "../models/LicenseDialog";
import { Refraction } from "./Refraction";

export function SeparateView() {
  const job = useApp((s) => s.job);
  const source = useApp((s) => s.source);
  const probing = useApp((s) => s.probing);

  return (
    <div className="mx-auto flex min-h-full max-w-[880px] flex-col justify-center py-10">
      <AnimatePresence mode="wait">
        {job ? (
          <Fade key="job">
            <Separating />
          </Fade>
        ) : probing ? (
          <Fade key="probing">
            <Probing name={probing.split("/").pop() ?? probing} />
          </Fade>
        ) : source ? (
          <Fade key="source">
            <SourceCard />
          </Fade>
        ) : (
          <Fade key="drop">
            <DropZone />
          </Fade>
        )}
      </AnimatePresence>
    </div>
  );
}

function Fade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      {children}
    </motion.div>
  );
}

function useDropTarget(onPath: (p: string) => void) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    void backend().then(async (b) => {
      off = await b.onDragDrop((e) => {
        if (e.type === "enter" || e.type === "over") setOver(true);
        else if (e.type === "leave") setOver(false);
        else {
          setOver(false);
          if (e.paths[0]) onPath(e.paths[0]);
        }
      });
    });
    return () => off?.();
  }, [onPath]);
  return over;
}

function DropZone() {
  const loadSource = useApp((s) => s.loadSource);
  const error = useApp((s) => s.sourceError);
  const projects = useApp((s) => s.projects);
  const openProject = useApp((s) => s.openProject);
  const go = useApp((s) => s.go);
  const over = useDropTarget(loadSource);
  const [exts, setExts] = useState<string[]>(["mp3", "wav", "flac", "m4a", "ogg"]);
  useEffect(() => {
    void backend().then((b) => b.appInfo()).then((i) => setExts(i.supportedExtensions));
  }, []);

  const browse = async () => {
    const p = await (await backend()).pickAudioFile(exts);
    if (p) void loadSource(p);
  };

  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="font-display text-[40px] leading-tight font-semibold tracking-tight">
          Split any song into <span className="brand-text">its colors</span>
        </h1>
        <p className="mt-3 text-[15px] text-muted">Vocals, drums, bass and more — separated on your Mac, privately.</p>
      </div>

      <motion.button
        onClick={browse}
        aria-label="Choose a song to separate"
        className={cx(
          "group relative flex h-[300px] w-full flex-col items-center justify-center overflow-hidden rounded-[24px] border-2 border-dashed transition-colors",
          over ? "border-[var(--brand-to)] bg-elevated" : "border-border bg-surface/60 hover:border-[var(--brand-from)]",
        )}
        animate={over ? { scale: 1.015 } : { scale: 1 }}
        whileHover={{ scale: 1.006 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      >
        <motion.div
          aria-hidden
          className="brand-gradient pointer-events-none absolute -inset-20 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-[0.10]"
          animate={over ? { opacity: 0.22 } : undefined}
        />
        <motion.div
          className="brand-gradient relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-[0_10px_40px_-10px_var(--brand-to)]"
          animate={over ? { y: -6, scale: 1.08 } : { y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 18 }}
        >
          <Upload size={28} />
        </motion.div>
        <div className="relative text-lg font-medium">{over ? "Release to load" : "Drop a song here"}</div>
        <div className="relative mt-1 text-sm text-muted">
          or <span className="brand-text font-semibold">browse your files</span>
        </div>
        <div className="relative mt-6 flex gap-1.5">
          {["mp3", "wav", "flac", "m4a", "ogg"].map((e) => (
            <Chip key={e}>{e.toUpperCase()}</Chip>
          ))}
        </div>
        {/* pulsing ring on hover */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-3 rounded-[18px] border border-transparent transition-colors group-hover:animate-pulse group-hover:border-[color-mix(in_oklab,var(--brand-from)_40%,transparent)]"
        />
      </motion.button>

      <AnimatePresence>{error && <ErrorCard error={error} onRetry={browse} />}</AnimatePresence>

      {projects.length > 0 && (
        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted">Recent</h2>
            <button className="text-[13px] text-muted hover:text-text" onClick={() => go("library")}>
              View library
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {projects.slice(0, 3).map((p, i) => (
              <motion.button
                key={p.id}
                onClick={() => openProject(p.id)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="glass rounded-2xl p-4 text-left transition-colors hover:border-border"
              >
                <div className="truncate text-sm font-medium">{p.title}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {formatTime(p.durationSecs)} · {formatDate(p.createdAt)}
                </div>
                <div className="mt-3 flex gap-1">
                  {p.stems.map((s) => (
                    <span key={s.id} className="h-1.5 flex-1 rounded-full" style={{ background: stemColor(s.id, s.color) }} />
                  ))}
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ErrorCard({ error, onRetry }: { error: AppError; onRetry?: () => void }) {
  const Icon = error.kind === "outOfMemory" ? MemoryStick : error.kind === "unsupportedFile" || error.kind === "corruptFile" ? FileWarning : AlertTriangle;
  const title =
    error.kind === "unsupportedFile"
      ? "That file type isn't supported"
      : error.kind === "corruptFile"
        ? "This file couldn't be read"
        : error.kind === "outOfMemory"
          ? "Not enough memory"
          : error.kind === "modelMissing" || error.kind === "invalidModel"
            ? "There's a problem with the model"
            : "Something went wrong";
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
      role="alert"
    >
      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] p-4">
        <Icon size={20} className="mt-0.5 shrink-0 text-danger" />
        <div className="flex-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-[13px] text-muted">{error.message}</div>
        </div>
        {onRetry && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={onRetry}>
            Try another
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function Probing({ name }: { name: string }) {
  return (
    <Card className="p-8">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-elevated">
          <FileAudio size={22} className="text-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{name}</div>
          <div className="mt-1 text-sm text-muted">Reading audio…</div>
        </div>
      </div>
      <div className="mt-6 h-16 animate-pulse rounded-xl bg-elevated" />
    </Card>
  );
}

function usableModels(models: ModelInfo[] | undefined, hidden: string[]) {
  return (models ?? []).filter((m) => !m.problem && !hidden.includes(m.manifest.id));
}

function SourceCard() {
  const source = useApp((s) => s.source)!;
  const settings = useApp((s) => s.settings)!;
  const models = useApp((s) => s.models);
  const clearSource = useApp((s) => s.clearSource);
  const separate = useApp((s) => s.separate);
  const updateSettings = useApp((s) => s.updateSettings);
  const jobError = useApp((s) => s.jobError);
  const loadSource = useApp((s) => s.loadSource);
  useDropTarget(loadSource);

  const list = usableModels(models?.listing.models, settings.hiddenModels);
  const [modelId, setModelId] = useState(
    list.find((m) => m.manifest.id === settings.activeModelId)?.manifest.id ?? list[0]?.manifest.id,
  );
  const model = list.find((m) => m.manifest.id === modelId);
  const qualities = model?.qualities ?? ["balanced"];
  const [quality, setQuality] = useState<Quality>(settings.quality);
  const q = qualities.includes(quality) ? quality : "balanced";
  const [licenseFor, setLicenseFor] = useState<ModelInfo | null>(null);
  const info = source.probe.info;

  const start = () => {
    if (!model) return;
    if (!model.bundled && !settings.acceptedLicenses.includes(model.manifest.id)) return setLicenseFor(model);
    void separate(model.manifest.id, q);
  };

  const hint = useMemo(() => {
    const p = model?.manifest.quality?.[q];
    if (!p) return null;
    return q === "fast" ? "Quickest, slightly less clean" : q === "best" ? `${Math.max(1, p.shifts)}× passes — slowest, cleanest` : "Good balance of speed and quality";
  }, [model, q]);

  return (
    <div>
      <Card className="overflow-hidden">
        <div className="flex items-start gap-4 p-6 pb-4">
          <div className="brand-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white">
            <Music2 size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-xl font-semibold">{info.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              {info.artist && <span>{info.artist}</span>}
              {info.artist && <span>·</span>}
              <span className="tabular">{formatTime(info.durationSecs)}</span>
              <span>·</span>
              <span>{(info.sampleRate / 1000).toFixed(1)} kHz {info.channels === 1 ? "mono" : "stereo"}</span>
              <span>·</span>
              <span className="truncate">{info.fileName}</span>
            </div>
          </div>
          <IconButton label="Remove file" onClick={clearSource}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="px-6 pb-6">
          <Waveform peaks={source.probe.peaks} color="var(--text)" height={72} normalize />
        </div>
        <div className="border-t border-hairline bg-surface/40 p-6">
          <div className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Model</div>
          <div className="grid gap-2" role="radiogroup" aria-label="Model">
            {list.map((m) => {
              const on = m.manifest.id === modelId;
              return (
                <button
                  key={m.manifest.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setModelId(m.manifest.id);
                    if (m.manifest.id !== settings.activeModelId) void updateSettings({ activeModelId: m.manifest.id });
                  }}
                  className={cx(
                    "flex items-center gap-4 rounded-2xl border p-3.5 text-left transition-colors",
                    on ? "border-[color-mix(in_oklab,var(--brand-from)_60%,transparent)] bg-elevated" : "border-hairline hover:border-border",
                  )}
                >
                  <span className={cx("h-4 w-4 shrink-0 rounded-full border-2", on ? "border-[var(--brand-to)] bg-[var(--brand-to)] shadow-[inset_0_0_0_3px_var(--elevated)]" : "border-border")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {m.manifest.name}
                      {m.nonCommercial && <Chip color="var(--warning)">Non-commercial</Chip>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.manifest.stems.map((s) => (
                        <StemChip key={s.id} id={s.id} label={s.label} color={s.color} />
                      ))}
                    </div>
                  </div>
                  {m.manifest.hints && (
                    <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                      <Meter label="Speed" value={m.manifest.hints.speed} />
                      <Meter label="Quality" value={m.manifest.hints.quality} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Segmented
                label="Quality"
                value={q}
                onChange={(v) => {
                  setQuality(v);
                  void updateSettings({ quality: v });
                }}
                options={(["fast", "balanced", "best"] as Quality[]).map((v) => ({
                  value: v,
                  label: QUALITY_LABEL[v],
                  disabled: !qualities.includes(v),
                  hint: !qualities.includes(v) ? "Not supported by this model" : undefined,
                }))}
              />
              {hint && <span className="text-[13px] text-muted">{hint}</span>}
            </div>
            <Button variant="primary" size="lg" onClick={start} disabled={!model} data-autofocus>
              Separate <ArrowRight size={18} />
            </Button>
          </div>
        </div>
      </Card>
      <AnimatePresence>{jobError && <ErrorCard error={jobError} />}</AnimatePresence>
      <LicenseDialog
        model={licenseFor}
        onClose={() => setLicenseFor(null)}
        onAccept={async (m) => {
          await updateSettings({ acceptedLicenses: [...settings.acceptedLicenses, m.manifest.id] });
          setLicenseFor(null);
          void separate(m.manifest.id, q);
        }}
      />
    </div>
  );
}

const STAGE_LABEL = {
  decoding: "Reading audio",
  loading: "Loading model",
  separating: "Separating",
  saving: "Saving stems",
} as const;

function Separating() {
  // Keep the last job so the exit animation can render after the job clears.
  const live = useApp((s) => s.job);
  const last = useRef(live);
  if (live) last.current = live;
  const job = last.current!;
  const cancel = useApp((s) => s.cancelJob);
  const models = useApp((s) => s.models);
  const [cancelling, setCancelling] = useState(false);
  const stems = models?.listing.models.find((m) => m.manifest.id === job.modelId)?.manifest.stems ?? [
    { id: "vocals" },
    { id: "drums" },
    { id: "bass" },
    { id: "other" },
  ];
  const overall = job.stage === "separating" ? 0.04 + job.fraction * 0.92 : job.stage === "saving" ? 0.98 : job.stage === "loading" ? 0.03 : 0.01;

  return (
    <div className="text-center">
      <Refraction stems={stems} progress={job.stage === "separating" ? job.fraction : job.stage === "saving" ? 1 : 0} />
      <h2 className="mt-6 truncate font-display text-2xl font-semibold">{job.title}</h2>
      <p className="mt-1 text-sm text-muted">
        {job.modelName}
        {job.device && ` · ${job.device}`}
      </p>
      <div className="mx-auto mt-8 max-w-[520px]">
        <ProgressBar value={overall} label="Separation progress" />
        <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
          <span aria-live="polite">
            {STAGE_LABEL[job.stage]}
            {job.stage === "separating" && <span className="tabular"> · {Math.round(job.fraction * 100)}%</span>}
          </span>
          <span className="tabular">{job.stage === "separating" ? formatEta(job.eta) : ""}</span>
        </div>
        <AnimatePresence>
          {job.note && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 text-[13px] text-muted">
              {job.note}
            </motion.p>
          )}
        </AnimatePresence>
        <Button
          className="mt-8"
          variant="ghost"
          onClick={() => {
            setCancelling(true);
            void cancel();
          }}
          disabled={cancelling}
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

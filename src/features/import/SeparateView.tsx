import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Check, FileAudio, FileWarning, LayoutGrid, List, MemoryStick, Music2, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppError, ModelInfo, Quality } from "../../bindings";
import { Waveform } from "../../components/Waveform";
import { StemSpinner } from "../../components/StemSpinner";
import { Button, Card, Chip, IconButton, Keys, Meter, ProgressBar, Segmented, Spinner, StemChip, cx } from "../../components/ui";
import { stemColor } from "../../lib/colors";
import { capsOf, keysFor } from "../../lib/shortcuts";
import { formatDate, formatEta, formatTime, QUALITY_LABEL } from "../../lib/format";
import { useApp } from "../../store/app";
import { LicenseDialog } from "../models/LicenseDialog";
import { Refraction } from "./Refraction";

export function SeparateView() {
  const job = useApp((s) => s.job);
  const source = useApp((s) => s.source);
  const probing = useApp((s) => s.probing);

  return (
    <div className="mx-auto flex min-h-full max-w-[820px] flex-col justify-center py-10">
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: "easeOut" }}>
      {children}
    </motion.div>
  );
}

function DropZone() {
  const pickSource = useApp((s) => s.pickSource);
  const error = useApp((s) => s.sourceError);
  const projects = useApp((s) => s.projects);
  const openProject = useApp((s) => s.openProject);
  const go = useApp((s) => s.go);
  const layout = useApp((s) => s.settings?.recentLayout ?? "tiles");
  const updateSettings = useApp((s) => s.updateSettings);
  const over = useApp((s) => s.dragOver);

  return (
    <div>
      <div className="mb-7 text-center">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.015em]">Split a song into its stems</h1>
        <p className="mt-2 text-[14px] text-muted">Vocals, drums, bass and more — separated on your Mac, privately.</p>
      </div>

      <motion.button
        onClick={() => void pickSource()}
        aria-label="Choose a song to separate"
        data-tip="Choose a song from your Mac"
        data-shortcut="open"
        className={cx(
          "group relative flex h-[260px] w-full flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed transition-colors duration-150",
          over ? "border-accent bg-accent-soft" : "border-border-strong bg-surface hover:border-accent hover:bg-elevated/50",
        )}
        animate={over ? { scale: 1.01 } : { scale: 1 }}
        transition={{ duration: 0.15 }}
      >
        <motion.div
          className={cx("mb-4 flex h-12 w-12 items-center justify-center rounded-xl transition-colors", over ? "bg-accent text-white" : "bg-elevated text-muted group-hover:text-accent")}
          animate={over ? { y: -4 } : { y: 0 }}
        >
          <Upload size={22} />
        </motion.div>
        <div className="text-[15px] font-medium">{over ? "Release to open" : "Drop a song here"}</div>
        <div className="mt-1 text-[13px] text-muted">
          or <span className="font-medium text-accent">choose a file</span> <span className="ml-1 opacity-70">{keysFor("open")}</span>
        </div>
        <div className="mt-5 flex gap-1.5">
          {["MP3", "WAV", "FLAC", "M4A", "OGG"].map((e) => (
            <Chip key={e}>{e}</Chip>
          ))}
        </div>
        {/* soft pulse while hovering */}
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 ring-4 ring-[var(--accent-soft)] transition-opacity group-hover:animate-pulse group-hover:opacity-100" />
      </motion.button>

      <AnimatePresence>{error && <ErrorCard error={error} onRetry={() => void pickSource()} />}</AnimatePresence>

      {projects.length > 0 && (
        <div className="mt-9">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <h2 className="text-[12px] font-semibold text-muted">Recent</h2>
            <div className="flex items-center gap-3">
              <Segmented
                label="Recent layout"
                size="sm"
                value={layout}
                onChange={(v) => void updateSettings({ recentLayout: v })}
                options={[
                  { value: "tiles", label: <LayoutGrid size={13} />, aria: "Show recent songs as tiles", tip: "Show recent songs as tiles" },
                  { value: "list", label: <List size={13} />, aria: "Show recent songs as a list", tip: "Show recent songs as a list" },
                ]}
              />
              <button className="text-[12px] text-muted hover:text-text" onClick={() => go("library")} data-tip="See every separated song" data-shortcut="goLibrary">
                Show all
              </button>
            </div>
          </div>
          {layout === "tiles" ? (
            <div className="grid grid-cols-3 gap-2.5">
              {projects.slice(0, 3).map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProject(p.id)}
                  data-tip={`Open ${p.title} — stems are cached, no waiting`}
                  className="card p-3.5 text-left transition-colors hover:bg-elevated"
                >
                  <div className="truncate text-[13px] font-medium">{p.title}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {formatTime(p.durationSecs)} · {formatDate(p.createdAt)}
                  </div>
                  <div className="mt-3 flex gap-1">
                    {p.stems.map((s) => (
                      <span key={s.id} className="h-1 flex-1 rounded-full" style={{ background: stemColor(s.id, s.color) }} />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <ul className="card divide-y divide-[var(--border)] overflow-hidden">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => openProject(p.id)}
                    data-tip={`Open ${p.title} — stems are cached, no waiting`}
                    className="flex w-full items-center gap-3.5 px-3.5 py-2.5 text-left transition-colors hover:bg-elevated/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{p.title}</div>
                      <div className="mt-0.5 truncate text-[12px] text-muted">
                        {[p.artist, formatTime(p.durationSecs), formatDate(p.createdAt)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {p.stems.map((s) => (
                        <span key={s.id} className="h-1.5 w-5 rounded-full" style={{ background: stemColor(s.id, s.color) }} />
                      ))}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
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
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden" role="alert">
      <div className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5">
        <Icon size={18} className="mt-px shrink-0 text-danger" />
        <div className="flex-1">
          <div className="text-[13px] font-medium">{title}</div>
          <div className="mt-0.5 text-[12px] text-muted">{error.message}</div>
        </div>
        {onRetry && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={onRetry} tip="Choose a different file" shortcut="open">
            Try another
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function Probing({ name }: { name: string }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 animate-pulse items-center justify-center rounded-lg bg-elevated">
          <FileAudio size={20} className="text-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{name}</div>
          <div className="mt-0.5 text-[12px] text-muted">Reading audio…</div>
        </div>
      </div>
      <div className="mt-5 h-16 animate-pulse rounded-lg bg-elevated" />
    </Card>
  );
}

function SourceCard() {
  const source = useApp((s) => s.source)!;
  const settings = useApp((s) => s.settings)!;
  const models = useApp((s) => s.models);
  const clearSource = useApp((s) => s.clearSource);
  const separate = useApp((s) => s.separate);
  const updateSettings = useApp((s) => s.updateSettings);
  const jobError = useApp((s) => s.jobError);

  const list = (models?.listing.models ?? []).filter((m) => !m.problem && !settings.hiddenModels.includes(m.manifest.id));
  const modelId = list.find((m) => m.manifest.id === settings.activeModelId)?.manifest.id ?? list[0]?.manifest.id;
  const model = list.find((m) => m.manifest.id === modelId);
  const qualities = model?.qualities ?? ["balanced"];
  const q: Quality = qualities.includes(settings.quality) ? settings.quality : "balanced";
  const [licenseFor, setLicenseFor] = useState<ModelInfo | null>(null);
  const info = source.probe.info;

  const start = () => {
    if (!model) return;
    if (!model.bundled && !settings.acceptedLicenses.includes(model.manifest.id)) return setLicenseFor(model);
    void separate(model.manifest.id, q);
  };

  const qualityTip = useMemo(
    () => ({
      fast: "Fastest. Slightly less clean separation.",
      balanced: "The recommended balance of speed and quality.",
      best: model?.manifest.architecture === "demucs" ? "Averages several passes. Cleanest, about 3× slower." : "More overlap between chunks. Cleanest, slower.",
    }),
    [model],
  );

  return (
    <div>
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3.5 p-5 pb-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Music2 size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold">{info.title}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
              {info.artist && <span>{info.artist} ·</span>}
              <span className="tabular">{formatTime(info.durationSecs)}</span>
              <span>·</span>
              <span>
                {(info.sampleRate / 1000).toFixed(1)} kHz {info.channels === 1 ? "mono" : "stereo"}
              </span>
              <span>·</span>
              <span className="truncate">{info.fileName}</span>
            </div>
          </div>
          <IconButton label="Remove this song" onClick={clearSource}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="px-5 pb-5">
          <Waveform peaks={source.probe.peaks} color="var(--muted)" height={64} normalize />
        </div>
        <div className="border-t border-border p-5">
          <div className="mb-2.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Model</div>
          <div className="grid gap-1.5" role="radiogroup" aria-label="Model">
            {list.map((m) => {
              const on = m.manifest.id === modelId;
              return (
                <button
                  key={m.manifest.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => void updateSettings({ activeModelId: m.manifest.id })}
                  data-tip={m.manifest.description || m.manifest.name}
                  className={cx(
                    "flex items-center gap-3.5 rounded-lg border p-3 text-left transition-colors",
                    on ? "border-accent bg-accent-soft" : "border-border hover:bg-elevated",
                  )}
                >
                  <span className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", on ? "border-accent bg-accent" : "border-border-strong")}>
                    {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      {m.manifest.name}
                      {m.nonCommercial && (
                        <Chip color="var(--warning)" tip="Output may not be used commercially">
                          Non-commercial
                        </Chip>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.manifest.stems.map((s) => (
                        <StemChip key={s.id} id={s.id} label={s.label} color={s.color} />
                      ))}
                    </div>
                  </div>
                  {m.manifest.hints && (
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Meter label="Speed" value={m.manifest.hints.speed} />
                      <Meter label="Quality" value={m.manifest.hints.quality} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-muted">Quality</span>
              <Segmented
                label="Quality"
                value={q}
                onChange={(v) => void updateSettings({ quality: v })}
                options={(["fast", "balanced", "best"] as Quality[]).map((v) => ({
                  value: v,
                  label: QUALITY_LABEL[v],
                  disabled: !qualities.includes(v),
                  tip: qualities.includes(v) ? qualityTip[v] : "Not supported by this model",
                }))}
              />
            </div>
            <Button variant="primary" size="lg" onClick={start} disabled={!model} data-autofocus tip="Split this song into stems" shortcut="separate">
              Separate <ArrowRight size={16} />
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

const STEPS = [
  { stage: "decoding", label: "Read the song" },
  { stage: "loading", label: "Prepare the model" },
  { stage: "separating", label: "Separate the stems" },
  { stage: "saving", label: "Save to your library" },
] as const;

/** Current time, re-rendered once a second. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Separating() {
  // Keep the last job so the exit animation can render after the job clears.
  const live = useApp((s) => s.job);
  const last = useRef(live);
  if (live) last.current = live;
  const job = last.current!;
  const cancel = useApp((s) => s.cancelJob);
  const models = useApp((s) => s.models);
  const [cancelling, setCancelling] = useState(false);
  const stems = models?.listing.models.find((m) => m.manifest.id === job.modelId)?.manifest.stems ?? [{ id: "vocals" }, { id: "drums" }, { id: "bass" }, { id: "other" }];
  const current = STEPS.findIndex((x) => x.stage === job.stage);
  const now = useNow();
  const stage = useRef({ name: job.stage, since: Date.now() });
  if (stage.current.name !== job.stage) stage.current = { name: job.stage, since: Date.now() };
  const stepElapsed = Math.max(0, (now - stage.current.since) / 1000);
  const totalElapsed = Math.max(0, (now - job.startedAt) / 1000);
  const preparing = job.stage === "decoding" || job.stage === "loading";
  const stepped = /model \d+ of \d+/.test(job.detail ?? "");
  const indeterminate = job.stage === "decoding" || (job.stage === "loading" && !stepped);
  const barValue = job.stage === "saving" ? 1 : job.stage === "separating" ? job.fraction : job.stage === "loading" && stepped ? job.fraction : 0;

  return (
    <div className="text-center">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={preparing ? "spin" : "flow"} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.2 }}>
          {preparing ? (
            <div className="flex h-[150px] items-center justify-center">
              <StemSpinner stems={stems} size={104} />
            </div>
          ) : (
            <Refraction stems={stems} progress={job.stage === "separating" ? job.fraction : 1} />
          )}
        </motion.div>
      </AnimatePresence>
      <h2 className="mt-6 truncate text-[20px] font-semibold">{job.title}</h2>
      <p className="mt-1 text-[13px] text-muted">
        {job.modelName}
        {job.device && ` · ${job.device}`}
      </p>

      <div className="mx-auto mt-7 max-w-[460px] text-left">
        <ol className="card divide-y divide-[var(--border)] overflow-hidden" aria-label="Separation steps">
          {STEPS.map((st, i) => {
            const state = i < current ? "done" : i === current ? "active" : "todo";
            return (
              <li key={st.stage} aria-current={state === "active" ? "step" : undefined} className={cx("flex items-start gap-3 px-3.5 py-2.5 transition-opacity", state === "todo" && "opacity-45")}>
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center">
                  {state === "done" ? (
                    <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }} className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent text-white">
                      <Check size={11} strokeWidth={3} />
                    </motion.span>
                  ) : state === "active" ? (
                    <Spinner className="h-[18px] w-[18px] border-2 text-accent" />
                  ) : (
                    <span className="h-[18px] w-[18px] rounded-full border-[1.5px] border-border-strong" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cx("text-[13px]", state === "active" ? "font-medium" : "text-muted")}>{st.label}</div>
                  <AnimatePresence initial={false}>
                    {state === "active" && job.detail && (
                      <motion.div key={job.detail} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="mt-0.5 truncate text-[12px] text-muted" aria-live="polite">
                        {job.detail}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <span className="tabular mt-px text-[12px] text-muted">
                  {state === "active" && (job.stage === "separating" ? `${Math.round(job.fraction * 100)}%` : formatTime(stepElapsed))}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-4">
          <ProgressBar value={barValue} indeterminate={indeterminate} label={STEPS[Math.max(0, current)].label} />
          <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
            <span className="tabular">Elapsed {formatTime(totalElapsed)}</span>
            <span className="tabular">{job.stage === "separating" ? formatEta(job.eta) : ""}</span>
          </div>
        </div>

        <AnimatePresence>
          {job.note && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 overflow-hidden rounded-lg bg-accent-soft px-3 py-2 text-[12px] leading-relaxed text-text">
              {job.note}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="text-center">
          <Button
            className="mt-6"
            onClick={() => {
              setCancelling(true);
              void cancel();
            }}
            disabled={cancelling}
            tip="Stop separating. Nothing is saved."
            shortcut="cancel"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
          <p className="mt-5 text-[12px] text-faint">
            You can keep using Prism while this runs. Press <Keys keys={capsOf(["mod", "."])} /> to cancel.
          </p>
        </div>
      </div>
    </div>
  );
}

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, FileAudio, ListOrdered, FileWarning, LayoutGrid, List, MemoryStick, Music2, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppError, ModelInfo, Quality } from "../../bindings";
import { Waveform } from "../../components/Waveform";
import { ActivityLog } from "../../components/ActivityLog";
import { StemSpinner } from "../../components/StemSpinner";
import { StepList } from "../../components/StepList";
import { Button, Card, Chip, IconButton, Meter, ProgressBar, Segmented, StemChip, cx } from "../../components/ui";
import { stemColor } from "../../lib/colors";
import { keysFor } from "../../lib/shortcuts";
import { formatDate, formatEta, formatTime, qualityLabel } from "../../lib/format";
import { useApp } from "../../store/app";
import { LicenseDialog } from "../models/LicenseDialog";
import { Refraction } from "./Refraction";
import { mark } from "../../i18n";
import { Rich } from "../../i18n/Rich";
import { useT } from "../../i18n/useT";

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
      <QueueList />
    </div>
  );
}

/** Songs waiting to be separated after the current one (drop several, or drop more while one runs). */
function QueueList() {
  const { t } = useT();
  const queue = useApp((s) => s.queue);
  const remove = useApp((s) => s.removeFromQueue);
  const clear = useApp((s) => s.clearQueue);
  const models = useApp((s) => s.models);
  const modelId = useApp((s) => s.lastRun?.modelId ?? s.settings?.activeModelId);
  const quality = useApp((s) => s.lastRun?.quality ?? s.settings?.quality);
  const modelName = models?.listing.models.find((m) => m.manifest.id === modelId)?.manifest.name ?? modelId;
  return (
    <AnimatePresence>
      {queue.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18 }}
          aria-label={t("Up next")}
          className="card mx-auto mt-8 w-full max-w-[520px] p-3"
        >
          <div className="mb-1.5 flex items-center justify-between px-1">
            <h2 className="flex items-center gap-2 text-[12px] font-semibold text-muted">
              <ListOrdered size={13} /> {t("Up next")} · {queue.length}
            </h2>
            <Button size="sm" variant="ghost" onClick={clear} tip={t("Remove every waiting song (the current one keeps going)")}>
              {t("Clear")}
            </Button>
          </div>
          <ul>
            {queue.map((q, i) => (
              <li key={q.path} className="group flex h-8 items-center gap-2.5 rounded-md px-1.5 hover:bg-elevated">
                <span className="tabular w-4 text-right text-[11px] text-faint">{i + 1}</span>
                <FileAudio size={14} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[13px]" data-tip={q.path}>
                  {q.name}
                </span>
                <IconButton label={t("Remove {name} from the queue", { name: q.name })} tip={t("Remove from the queue")} onClick={() => remove(q.path)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                  <X size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
          {modelName && quality && (
            <p className="mt-1.5 px-1 text-[11px] text-faint">
              {t("Each uses {model} · {quality}, like the last separation. Finished songs go to the Library.", { model: modelName, quality: qualityLabel(quality) })}
            </p>
          )}
        </motion.section>
      )}
    </AnimatePresence>
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
  const { t } = useT();
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
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.015em]">{t("Split a song into its stems")}</h1>
        <p className="mt-2 text-[14px] text-muted">{t("Vocals, drums, bass and more — separated on your Mac, privately.")}</p>
      </div>

      <motion.button
        onClick={() => void pickSource()}
        aria-label={t("Choose a song to separate")}
        data-tip={t("Choose a song from your Mac")}
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
        <div className="text-[15px] font-medium">{over ? t("Release to open") : t("Drop songs here")}</div>
        <div className="mt-1 text-[13px] text-muted">
          {t("or")} <span className="font-medium text-accent">{t("choose a file")}</span> <span className="ml-1 opacity-70">{keysFor("open")}</span>
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
            <h2 className="text-[12px] font-semibold text-muted">{t("Recent")}</h2>
            <div className="flex items-center gap-3">
              <Segmented
                label={t("Recent layout")}
                size="sm"
                value={layout}
                onChange={(v) => void updateSettings({ recentLayout: v })}
                options={[
                  { value: "tiles", label: <LayoutGrid size={13} />, aria: t("Show recent songs as tiles"), tip: t("Show recent songs as tiles") },
                  { value: "list", label: <List size={13} />, aria: t("Show recent songs as a list"), tip: t("Show recent songs as a list") },
                ]}
              />
              <button className="text-[12px] text-muted hover:text-text" onClick={() => go("library")} data-tip={t("See every separated song")} data-shortcut="goLibrary">
                {t("Show all")}
              </button>
            </div>
          </div>
          {layout === "tiles" ? (
            <div className="grid grid-cols-3 gap-2.5">
              {projects.slice(0, 3).map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProject(p.id)}
                  data-tip={t("Open {title} — stems are cached, no waiting", { title: p.title })}
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
                    data-tip={t("Open {title} — stems are cached, no waiting", { title: p.title })}
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
  const { t } = useT();
  const Icon = error.kind === "outOfMemory" ? MemoryStick : error.kind === "unsupportedFile" || error.kind === "corruptFile" ? FileWarning : AlertTriangle;
  const title =
    error.kind === "unsupportedFile"
      ? t("That file type isn't supported")
      : error.kind === "corruptFile"
        ? t("This file couldn't be read")
        : error.kind === "outOfMemory"
          ? t("Not enough memory")
          : error.kind === "modelMissing" || error.kind === "invalidModel"
            ? t("There's a problem with the model")
            : t("Something went wrong");
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden" role="alert">
      <div className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5">
        <Icon size={18} className="mt-px shrink-0 text-danger" />
        <div className="flex-1">
          <div className="text-[13px] font-medium">{title}</div>
          <div className="mt-0.5 text-[12px] text-muted">{error.message}</div>
        </div>
        {onRetry && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={onRetry} tip={t("Choose a different file")} shortcut="open">
            {t("Try another")}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function Probing({ name }: { name: string }) {
  const { t } = useT();
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 animate-pulse items-center justify-center rounded-lg bg-elevated">
          <FileAudio size={20} className="text-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{name}</div>
          <div className="mt-0.5 text-[12px] text-muted">{t("Reading audio…")}</div>
        </div>
      </div>
      <div className="mt-5 h-16 animate-pulse rounded-lg bg-elevated" />
    </Card>
  );
}

function SourceCard() {
  const { t } = useT();
  const source = useApp((s) => s.source)!;
  const settings = useApp((s) => s.settings)!;
  const models = useApp((s) => s.models);
  const clearSource = useApp((s) => s.clearSource);
  const separate = useApp((s) => s.separate);
  const updateSettings = useApp((s) => s.updateSettings);
  const jobError = useApp((s) => s.jobError);
  const go = useApp((s) => s.go);

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
      fast: t("Fastest. Slightly less clean separation."),
      balanced: t("The recommended balance of speed and quality."),
      best: model?.manifest.architecture === "demucs" ? t("Averages several passes. Cleanest, about 3× slower.") : t("More overlap between chunks. Cleanest, slower."),
    }),
    [model, t],
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
                {(info.sampleRate / 1000).toFixed(1)} kHz {info.channels === 1 ? t("mono") : t("stereo")}
              </span>
              <span>·</span>
              <span className="truncate">{info.fileName}</span>
            </div>
          </div>
          <IconButton label={t("Remove this song")} onClick={clearSource}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="px-5 pb-5">
          <Waveform peaks={source.probe.peaks} color="var(--muted)" height={64} normalize />
        </div>
        <div className="border-t border-border p-5">
          <div className="mb-2.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{t("Model")}</div>
          <div className="grid gap-1.5" role="radiogroup" aria-label={t("Model")}>
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
                        <Chip color="var(--warning)" tip={t("Output may not be used commercially")}>
                          {t("Non-commercial")}
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
                      <Meter label={t("Speed")} value={m.manifest.hints.speed} />
                      <Meter label={t("Quality")} value={m.manifest.hints.quality} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {!list.some((m) => m.manifest.stems.some((s) => s.id === "guitar")) && (
            <button className="mt-2.5 text-left text-[12px] text-muted hover:text-text" onClick={() => go("models")} data-tip={t("Open Models to add the 6-stem model")}>
              {t("Need guitar as its own stem? Get the 6-stem model in Models.")}
            </button>
          )}

          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-muted">{t("Quality")}</span>
              <Segmented
                label={t("Quality")}
                value={q}
                onChange={(v) => void updateSettings({ quality: v })}
                options={(["fast", "balanced", "best"] as Quality[]).map((v) => ({
                  value: v,
                  label: qualityLabel(v),
                  disabled: !qualities.includes(v),
                  tip: qualities.includes(v) ? qualityTip[v] : t("Not supported by this model"),
                }))}
              />
            </div>
            <Button variant="primary" size="lg" onClick={start} disabled={!model} data-autofocus tip={t("Split this song into stems")} shortcut="separate">
              {t("Separate")} <ArrowRight size={16} />
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
  { stage: "decoding", label: mark("Read the song") },
  { stage: "loading", label: mark("Prepare the model") },
  { stage: "separating", label: mark("Separate the stems") },
  { stage: "saving", label: mark("Save to your library") },
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
  const { t, tb } = useT();
  // Keep the last job so the exit animation can render after the job clears.
  const live = useApp((s) => s.job);
  const last = useRef(live);
  if (live) last.current = live;
  const job = last.current!;
  const cancel = useApp((s) => s.cancelJob);
  const models = useApp((s) => s.models);
  const [cancelling, setCancelling] = useState(false);
  const queued = useApp((s) => s.queue.length);
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
      <div className="mt-2">
        <ActivityLog lines={job.log} />
      </div>
      <h2 className="mt-4 truncate text-[20px] font-semibold">{job.title}</h2>
      <p className="mt-1 text-[13px] text-muted">
        {job.modelName}
        {job.device && ` · ${job.device}`}
      </p>

      <div className="mx-auto mt-7 max-w-[460px] text-left">
        <StepList
          label={t("Separation steps")}
          steps={STEPS.map((x) => ({ key: x.stage, label: t(x.label) }))}
          current={current}
          detail={job.detail ? tb(job.detail) : job.detail}
          trailing={job.stage === "separating" ? `${Math.round(job.fraction * 100)}%` : formatTime(stepElapsed)}
        />

        <div className="mt-4">
          <ProgressBar value={barValue} indeterminate={indeterminate} label={STEPS[Math.max(0, current)].label} />
          <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
            <span className="tabular">{t("Elapsed {time}", { time: formatTime(totalElapsed) })}</span>
            <span className="tabular">{job.stage === "separating" ? formatEta(job.eta) : ""}</span>
          </div>
        </div>

        <AnimatePresence>
          {job.note && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 overflow-hidden rounded-lg bg-accent-soft px-3 py-2 text-[12px] leading-relaxed text-text">
              {tb(job.note)}
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
            tip={queued ? t("Stop this song (nothing is saved) and go on with the next one") : t("Stop separating. Nothing is saved.")}
            shortcut="cancel"
          >
            {cancelling ? t("Cancelling…") : queued ? t("Skip this song") : t("Cancel")}
          </Button>
          <p className="mt-5 text-[12px] text-faint">
            <Rich text={queued ? t("You can keep using Prism while this runs, and drop more songs to queue them. Press {key:mod+.} to skip.") : t("You can keep using Prism while this runs, and drop more songs to queue them. Press {key:mod+.} to cancel.")} />
          </p>
        </div>
      </div>
    </div>
  );
}

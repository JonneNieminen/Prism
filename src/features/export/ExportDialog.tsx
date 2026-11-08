import { Archive, AudioLines, FileAudio } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ExportFormat, ExportRange, Project } from "../../bindings";
import { Modal } from "../../components/Modal";
import { Button, ProgressBar, Segmented, StemChip, cx } from "../../components/ui";
import { effectiveGains, type StemMix } from "../../lib/audio/engine";
import { backend, toAppError } from "../../lib/ipc";
import { formatTime, stemLabel } from "../../lib/format";
import { showInFileManager } from "../../lib/platform";
import { useApp, type ExportTarget } from "../../store/app";
import { usePlayer } from "../player/playerStore";
import { mark } from "../../i18n";
import { useT } from "../../i18n/useT";

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: "wav", label: "WAV", hint: mark("Lossless, 24-bit — best for editing") },
  { value: "flac", label: "FLAC", hint: mark("Lossless and about half the size of WAV") },
  { value: "mp3", label: "MP3", hint: mark("Small and plays everywhere") },
];

/** "1m05s": a file-name-safe time. */
const timeTag = (t: number) => `${Math.floor(t / 60)}m${String(Math.floor(t % 60)).padStart(2, "0")}s`;

export function ExportDialog({ project, mix }: { project: Project; mix: StemMix[] }) {
  const { t } = useT();
  const target = useApp((s) => s.exportTarget);
  const setTarget = useApp((s) => s.setExportTarget);
  const settings = useApp((s) => s.settings)!;
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [kind, setKind] = useState<ExportTarget["kind"]>("mix");
  const [stemId, setStemId] = useState(project.stems[0]?.id);
  const [format, setFormat] = useState<ExportFormat>(settings.exportFormat);
  const [bitrate, setBitrate] = useState(settings.mp3Bitrate);
  const [busy, setBusy] = useState<number | null>(null);
  const loop = usePlayer((s) => s.loop);
  const loopOn = usePlayer((s) => s.loopOn);
  const [onlyLoop, setOnlyLoop] = useState(false);
  const onClose = () => busy === null && setTarget(null);

  useEffect(() => {
    if (!target) return;
    setKind(target.kind);
    if (target.kind === "stem") setStemId(target.stemId);
    setFormat(settings.exportFormat);
    setBitrate(settings.mp3Bitrate);
    setOnlyLoop(loopOn && !!loop);
    setBusy(null);
  }, [target]);

  const gains = effectiveGains(mix);
  const kept = project.stems.filter((s) => gains.find((g) => g.stemId === s.id && g.gain > 0));
  const removed = project.stems.filter((s) => !kept.includes(s));
  const mixSuffix = removed.length === 0 ? "full mix" : kept.length === 1 ? `${kept[0].id} only` : `no ${removed.map((s) => s.id).join(" + ")}`;
  const ext = kind === "zip" ? "zip" : format;
  const range: ExportRange | null = onlyLoop && loop ? { startSecs: loop.start, endSecs: loop.end } : null;
  const baseSuffix = kind === "mix" ? mixSuffix : kind === "zip" ? "stems" : (stemId ?? "stem");
  const suffix = range ? `${baseSuffix} ${timeTag(range.startSecs)}-${timeTag(range.endSecs)}` : baseSuffix;

  const run = async () => {
    const b = await backend();
    const name = await b.suggestFileName(project.title, suffix, ext);
    const defaultPath = settings.defaultSaveDir ? b.joinPath(settings.defaultSaveDir, name) : name;
    const path = await b.pickSavePath(defaultPath, ext);
    if (!path) return;
    const options = { format, mp3Bitrate: bitrate, ...(range ? { range } : {}) };
    void updateSettings({ exportFormat: format, mp3Bitrate: bitrate });
    setBusy(0);
    const jobId = `zip-${crypto.randomUUID()}`;
    const off = await b.onExportProgress((e) => e.jobId === jobId && setBusy(e.fraction));
    try {
      if (kind === "mix") await b.exportMix(project.id, gains, options, path);
      else if (kind === "stem") await b.exportStem(project.id, stemId!, options, path);
      else await b.exportZip(jobId, project.id, options, path);
      setBusy(null);
      setTarget(null);
      toast({ tone: "success", title: t("Export complete"), body: path.split(/[\\/]/).pop(), action: { label: t(showInFileManager), run: () => void b.reveal(path) } });
    } catch (e) {
      toast({ tone: "error", title: t("Export failed"), body: toAppError(e).message });
      setBusy(null);
    } finally {
      off();
    }
  };

  const options = [
    { kind: "mix" as const, icon: AudioLines, title: t("Current mix"), desc: removed.length ? t("Without {stems}", { stems: removed.map((s) => stemLabel(s.label).toLowerCase()).join(", ") }) : t("All stems on"), tip: t("Exactly what you hear, as one file"), shortcut: "exportMix" },
    { kind: "stem" as const, icon: FileAudio, title: t("Single stem"), desc: t("One instrument on its own"), tip: t("Pick one stem to save") },
    { kind: "zip" as const, icon: Archive, title: t("All stems"), desc: t("{n} files in a .zip", { n: project.stems.length }), tip: t("Every stem, each as its own file"), shortcut: "exportStems" },
  ];

  return (
    <Modal open={!!target} onClose={onClose} title={t("Export")} width={500}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("What to export")}>
        {options.map((o) => (
          <button
            key={o.kind}
            role="radio"
            aria-checked={kind === o.kind}
            onClick={() => setKind(o.kind)}
            disabled={busy !== null}
            data-tip={o.tip}
            data-shortcut={o.shortcut}
            className={cx("rounded-lg border p-3 text-left transition-colors", kind === o.kind ? "border-accent bg-accent-soft" : "border-border hover:bg-elevated")}
          >
            <o.icon size={16} className={kind === o.kind ? "text-accent" : "text-muted"} />
            <div className="mt-2 text-[13px] font-medium">{o.title}</div>
            <div className="mt-0.5 text-[11px] text-muted">{o.desc}</div>
          </button>
        ))}
      </div>

      {kind === "stem" && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Stem")}>
          {project.stems.map((s) => (
            <button key={s.id} role="radio" aria-checked={stemId === s.id} onClick={() => setStemId(s.id)} data-tip={t("Export {name}", { name: stemLabel(s.label) })} className={cx("rounded-md transition-opacity", stemId === s.id ? "opacity-100" : "opacity-40 hover:opacity-75")}>
              <StemChip id={s.id} label={s.label} color={s.color} />
            </button>
          ))}
        </div>
      )}
      {kind === "mix" && kept.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {kept.map((s) => (
            <StemChip key={s.id} id={s.id} label={s.label} color={s.color} />
          ))}
        </div>
      )}

      {loop && (
        <div className="mt-5 flex items-center justify-between">
          <span className="text-[13px]">{t("Length")}</span>
          <Segmented
            label={t("Length")}
            value={onlyLoop ? "loop" : "song"}
            onChange={(v) => setOnlyLoop(v === "loop")}
            options={[
              { value: "song", label: t("Whole song"), tip: t("Export from the start to the end") },
              { value: "loop", label: t("Loop {from}–{to}", { from: formatTime(loop.start), to: formatTime(loop.end) }), tip: t("Export only the part you are looping") },
            ]}
          />
        </div>
      )}
      <div className={cx("flex items-center justify-between", loop ? "mt-3" : "mt-5")}>
        <span className="text-[13px]">{t("Format")}</span>
        <Segmented label={t("Format")} value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.label, tip: t(f.hint) }))} />
      </div>
      {format === "mp3" && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[13px]">{t("Bitrate")}</span>
          <Segmented
            label={t("Bitrate")}
            size="sm"
            value={String(bitrate)}
            onChange={(v) => setBitrate(Number(v))}
            options={[
              { value: "128", label: "128", tip: t("Smallest files") },
              { value: "192", label: "192", tip: t("Good for listening") },
              { value: "256", label: "256", tip: t("High quality") },
              { value: "320", label: "320 kbps", tip: t("Highest MP3 quality") },
            ]}
          />
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted">{t("{hint}. You'll choose where to save next.", { hint: t(FORMATS.find((f) => f.value === format)?.hint ?? "") })}</p>

      {busy !== null ? (
        <div className="mt-5">
          {kind === "zip" ? (
            <ProgressBar value={busy} label={t("Export progress")} />
          ) : (
            <div role="progressbar" aria-label={t("Exporting")} className="relative h-1.5 overflow-hidden rounded-full bg-pressed">
              <motion.div
                className="absolute inset-y-0 w-1/3 rounded-full bg-accent"
                animate={{ left: ["-33%", "100%"] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          )}
          <p className="mt-2 text-center text-[12px] text-muted">{kind === "zip" ? t("Encoding stem {n} of {total}…", { n: Math.min(project.stems.length, Math.floor(busy * project.stems.length) + 1), total: project.stems.length }) : t("Encoding…")}</p>
        </div>
      ) : (
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} tip={t("Close without exporting")} shortcut="closeDialog">
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={kind === "mix" && kept.length === 0} data-autofocus tip={t("Choose where to save")}>
            {t("Export…")}
          </Button>
        </div>
      )}
    </Modal>
  );
}

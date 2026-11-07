import { Archive, AudioLines, FileAudio } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ExportFormat, Project } from "../../bindings";
import { Modal } from "../../components/Modal";
import { Button, ProgressBar, Segmented, StemChip, cx } from "../../components/ui";
import { effectiveGains, type StemMix } from "../../lib/audio/engine";
import { backend, toAppError } from "../../lib/ipc";
import { useApp, type ExportTarget } from "../../store/app";

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: "wav", label: "WAV", hint: "Lossless, 24-bit — best for editing" },
  { value: "flac", label: "FLAC", hint: "Lossless and about half the size of WAV" },
  { value: "mp3", label: "MP3", hint: "Small and plays everywhere" },
];

export function ExportDialog({ project, mix }: { project: Project; mix: StemMix[] }) {
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
  const onClose = () => busy === null && setTarget(null);

  useEffect(() => {
    if (!target) return;
    setKind(target.kind);
    if (target.kind === "stem") setStemId(target.stemId);
    setFormat(settings.exportFormat);
    setBitrate(settings.mp3Bitrate);
    setBusy(null);
  }, [target]);

  const gains = effectiveGains(mix);
  const kept = project.stems.filter((s) => gains.find((g) => g.stemId === s.id && g.gain > 0));
  const removed = project.stems.filter((s) => !kept.includes(s));
  const mixSuffix = removed.length === 0 ? "full mix" : kept.length === 1 ? `${kept[0].id} only` : `no ${removed.map((s) => s.id).join(" + ")}`;
  const ext = kind === "zip" ? "zip" : format;
  const suffix = kind === "mix" ? mixSuffix : kind === "zip" ? "stems" : (stemId ?? "stem");

  const run = async () => {
    const b = await backend();
    const name = await b.suggestFileName(project.title, suffix, ext);
    const defaultPath = settings.defaultSaveDir ? b.joinPath(settings.defaultSaveDir, name) : name;
    const path = await b.pickSavePath(defaultPath, ext);
    if (!path) return;
    const options = { format, mp3Bitrate: bitrate };
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
      toast({ tone: "success", title: "Export complete", body: path.split("/").pop(), action: { label: "Show in Finder", run: () => void b.reveal(path) } });
    } catch (e) {
      toast({ tone: "error", title: "Export failed", body: toAppError(e).message });
      setBusy(null);
    } finally {
      off();
    }
  };

  const options = [
    { kind: "mix" as const, icon: AudioLines, title: "Current mix", desc: removed.length ? `Without ${removed.map((s) => s.label.toLowerCase()).join(", ")}` : "All stems on", tip: "Exactly what you hear, as one file", shortcut: "exportMix" },
    { kind: "stem" as const, icon: FileAudio, title: "Single stem", desc: "One instrument on its own", tip: "Pick one stem to save" },
    { kind: "zip" as const, icon: Archive, title: "All stems", desc: `${project.stems.length} files in a .zip`, tip: "Every stem, each as its own file", shortcut: "exportStems" },
  ];

  return (
    <Modal open={!!target} onClose={onClose} title="Export" width={500}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="What to export">
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
        <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Stem">
          {project.stems.map((s) => (
            <button key={s.id} role="radio" aria-checked={stemId === s.id} onClick={() => setStemId(s.id)} data-tip={`Export ${s.label}`} className={cx("rounded-md transition-opacity", stemId === s.id ? "opacity-100" : "opacity-40 hover:opacity-75")}>
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

      <div className="mt-5 flex items-center justify-between">
        <span className="text-[13px]">Format</span>
        <Segmented label="Format" value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.label, tip: f.hint }))} />
      </div>
      {format === "mp3" && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[13px]">Bitrate</span>
          <Segmented
            label="Bitrate"
            size="sm"
            value={String(bitrate)}
            onChange={(v) => setBitrate(Number(v))}
            options={[
              { value: "128", label: "128", tip: "Smallest files" },
              { value: "192", label: "192", tip: "Good for listening" },
              { value: "256", label: "256", tip: "High quality" },
              { value: "320", label: "320 kbps", tip: "Highest MP3 quality" },
            ]}
          />
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted">{FORMATS.find((f) => f.value === format)?.hint}. You'll choose where to save next.</p>

      {busy !== null ? (
        <div className="mt-5">
          {kind === "zip" ? (
            <ProgressBar value={busy} label="Export progress" />
          ) : (
            <div role="progressbar" aria-label="Exporting" className="relative h-1.5 overflow-hidden rounded-full bg-pressed">
              <motion.div
                className="absolute inset-y-0 w-1/3 rounded-full bg-accent"
                animate={{ left: ["-33%", "100%"] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          )}
          <p className="mt-2 text-center text-[12px] text-muted">{kind === "zip" ? `Encoding stem ${Math.min(project.stems.length, Math.floor(busy * project.stems.length) + 1)} of ${project.stems.length}…` : "Encoding…"}</p>
        </div>
      ) : (
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} tip="Close without exporting" shortcut="closeDialog">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={kind === "mix" && kept.length === 0} data-autofocus tip="Choose where to save">
            Export…
          </Button>
        </div>
      )}
    </Modal>
  );
}

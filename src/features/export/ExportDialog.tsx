import { Archive, AudioLines, FileAudio } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExportFormat, Project } from "../../bindings";
import { Modal } from "../../components/Modal";
import { Button, ProgressBar, Segmented, StemChip, cx } from "../../components/ui";
import { effectiveGains, type StemMix } from "../../lib/audio/engine";
import { backend, toAppError } from "../../lib/ipc";
import { useApp } from "../../store/app";

export type ExportTarget = { kind: "mix" } | { kind: "zip" } | { kind: "stem"; stemId: string };

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: "wav", label: "WAV", hint: "Lossless, 24-bit" },
  { value: "flac", label: "FLAC", hint: "Lossless, compressed" },
  { value: "mp3", label: "MP3", hint: "Small, widely compatible" },
];

export function ExportDialog({
  target,
  onClose,
  project,
  mix,
}: {
  target: ExportTarget | null;
  onClose: () => void;
  project: Project;
  mix: StemMix[];
}) {
  const settings = useApp((s) => s.settings)!;
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [kind, setKind] = useState<ExportTarget["kind"]>("mix");
  const [stemId, setStemId] = useState(project.stems[0]?.id);
  const [format, setFormat] = useState<ExportFormat>(settings.exportFormat);
  const [bitrate, setBitrate] = useState(settings.mp3Bitrate);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!target) return;
    setKind(target.kind);
    if (target.kind === "stem") setStemId(target.stemId);
    setFormat(settings.exportFormat);
    setBitrate(settings.mp3Bitrate);
    setBusy(null);
  }, [target, settings.exportFormat, settings.mp3Bitrate]);

  const gains = effectiveGains(mix);
  const kept = project.stems.filter((s) => gains.find((g) => g.stemId === s.id && g.gain > 0));
  const removed = project.stems.filter((s) => !kept.includes(s));
  const mixSuffix =
    removed.length === 0 ? "full mix" : kept.length === 1 ? `${kept[0].id} only` : `no ${removed.map((s) => s.id).join(" + ")}`;
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
      onClose();
      toast({
        tone: "success",
        title: "Export complete",
        body: path.split("/").pop(),
        action: { label: "Show in Finder", run: () => void b.reveal(path) },
      });
    } catch (e) {
      toast({ tone: "error", title: "Export failed", body: toAppError(e).message });
      setBusy(null);
    } finally {
      off();
    }
  };

  const options = [
    { kind: "mix" as const, icon: AudioLines, title: "Current mix", desc: removed.length ? `Without ${removed.map((s) => s.label.toLowerCase()).join(", ")}` : "All stems on" },
    { kind: "stem" as const, icon: FileAudio, title: "Single stem", desc: "One instrument as its own file" },
    { kind: "zip" as const, icon: Archive, title: "All stems", desc: `${project.stems.length} files in a .zip` },
  ];

  return (
    <Modal open={!!target} onClose={busy === null ? onClose : () => {}} title="Export" width={520}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="What to export">
        {options.map((o) => (
          <button
            key={o.kind}
            role="radio"
            aria-checked={kind === o.kind}
            onClick={() => setKind(o.kind)}
            disabled={busy !== null}
            className={cx(
              "rounded-2xl border p-3 text-left transition-colors",
              kind === o.kind ? "border-[color-mix(in_oklab,var(--brand-from)_60%,transparent)] bg-elevated" : "border-hairline hover:border-border",
            )}
          >
            <o.icon size={18} className={kind === o.kind ? "text-[var(--brand-to)]" : "text-muted"} />
            <div className="mt-2 text-sm font-medium">{o.title}</div>
            <div className="mt-0.5 text-xs text-muted">{o.desc}</div>
          </button>
        ))}
      </div>

      {kind === "stem" && (
        <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Stem">
          {project.stems.map((s) => (
            <button key={s.id} role="radio" aria-checked={stemId === s.id} onClick={() => setStemId(s.id)} className={cx("rounded-full transition-opacity", stemId === s.id ? "opacity-100" : "opacity-45 hover:opacity-80")}>
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

      <div className="mt-6 flex items-center justify-between">
        <span className="text-sm font-medium">Format</span>
        <Segmented label="Format" value={format} onChange={setFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.label, hint: f.hint }))} />
      </div>
      {format === "mp3" && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-medium">Bitrate</span>
          <Segmented
            label="Bitrate"
            size="sm"
            value={String(bitrate)}
            onChange={(v) => setBitrate(Number(v))}
            options={["128", "192", "256", "320"].map((v) => ({ value: v, label: `${v} kbps` }))}
          />
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{FORMATS.find((f) => f.value === format)?.hint}. You'll choose where to save next.</p>

      {busy !== null ? (
        <div className="mt-6">
          <ProgressBar value={kind === "zip" ? busy : 0.6} label="Export progress" />
          <p className="mt-2 text-center text-[13px] text-muted">Encoding…</p>
        </div>
      ) : (
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={kind === "mix" && kept.length === 0} data-autofocus>
            Export…
          </Button>
        </div>
      )}
    </Modal>
  );
}

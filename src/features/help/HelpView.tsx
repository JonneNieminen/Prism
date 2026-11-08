import { AudioLines, Boxes, Download, Flag, Gauge, Library, LifeBuoy, Metronome, ShieldCheck, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Card, Keys, PageHeader, cx } from "../../components/ui";
import { capsOf } from "../../lib/shortcuts";
import { useApp } from "../../store/app";

type Section = { id: string; icon: typeof Flag; title: string; body: ReactNode };

const K = ({ k }: { k: string[] }) => <Keys keys={capsOf(k)} />;

const SECTIONS: Section[] = [
  {
    id: "start",
    icon: Flag,
    title: "Getting started",
    body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>
          Drop a song onto the <b>Separate</b> screen, or press <K k={["mod", "O"]} /> to choose one. MP3, WAV, FLAC, M4A and OGG work.
        </li>
        <li>Check the preview, pick a model and a quality, then press <b>Separate</b> (<K k={["mod", "↩"]} />).</li>
        <li>When it's done the player opens. Mute, solo and mix the stems, then export what you need.</li>
      </ol>
    ),
  },
  {
    id: "separate",
    icon: Gauge,
    title: "Separating",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          <b>Fast</b> is quickest, <b>Balanced</b> is the recommended default and <b>Best</b> averages several passes for the cleanest result (about 3× slower).
        </li>
        <li>
          On Apple Silicon the first separation with a model takes about a minute longer while macOS optimizes the model for your Mac. After that it's
          cached — a 4-minute song takes roughly 25 seconds.
        </li>
        <li>
          You can keep browsing while it runs. Cancel any time with <K k={["mod", "."]} />.
        </li>
      </ul>
    ),
  },
  {
    id: "player",
    icon: AudioLines,
    title: "The player",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          Every stem plays in sync. Click a stem's name or its colored dot to mute it — <K k={["shift"]} />-click to mute or unmute a range of stems.{" "}
          <b>S</b> solos a stem (solo wins over mute, like a mixing desk). Drag a stem's slider to change its
          volume; double-click the slider to reset it. The <b>Master volume</b> slider and sound switch at the bottom of the sidebar control everything Prism plays, in every view.
        </li>
        <li>
          <b>Karaoke</b> removes the vocals, <b>A cappella</b> leaves only the vocals, <b>Reset</b> turns everything back on.
        </li>
        <li>
          Click a waveform to jump there, or drag to scrub. <K k={["space"]} /> plays and pauses, <K k={["←"]} /> <K k={["→"]} /> skip 5 seconds and the number keys mute
          stems 1–9 (hold <K k={["shift"]} /> to solo).
        </li>
      </ul>
    ),
  },
  {
    id: "export",
    icon: Download,
    title: "Exporting",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          <b>Current mix</b> saves exactly what you hear as one file (<K k={["mod", "E"]} />). <b>Download all stems</b> saves a .zip with one file per stem (
          <K k={["shift"]} /> <K k={["mod", "E"]} />). The download button on a stem saves just that stem.
        </li>
        <li>
          WAV is 24-bit and lossless, FLAC is lossless and smaller, MP3 is smallest (128–320 kbps). Files are named like <i>Song Title - vocals.wav</i>.
        </li>
        <li>Set a default save folder in Settings to skip navigating every time.</li>
      </ul>
    ),
  },
  {
    id: "analyze",
    icon: Metronome,
    title: "Key & BPM",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          Open <b>Key &amp; BPM</b> in the sidebar to find a song's tempo and musical key without separating it. Drop a song there or choose a file.
        </li>
        <li>
          Tempo can land on half or double time, so the alternatives are shown. The key comes with its Camelot code (for harmonic mixing) and its
          relative key, which shares the same notes and is the most common mix-up.
        </li>
        <li>
          <b>Separate this song</b> hands it straight to Separate — it's already decoded, so it starts right away.
        </li>
      </ul>
    ),
  },
  {
    id: "library",
    icon: Library,
    title: "Library",
    body: (
      <p>
        Separations are kept in the Library, so reopening a song is instant — no reprocessing. Each entry remembers which model made it. To save disk
        space, songs are deleted automatically after 7 days; change that (or choose Never) in Settings → Storage → Delete old songs. Rename or delete
        entries in the Library. Your original song files are never changed or copied.
      </p>
    ),
  },
  {
    id: "models",
    icon: Boxes,
    title: "Models",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          Prism ships with <b>Demucs v4 (4 stems)</b>. The Models screen's catalog offers more: 6 stems (adds guitar and piano), a fine-tuned Demucs and
          two MDX-Net models specialised in vocals or instrumentals.
        </li>
        <li>
          To add your own, use <b>Import folder</b> or <b>Import .zip</b>. A model is a folder with a <code>model.json</code> and ONNX weights — see
          "Adding your own model" in the README.
        </li>
        <li>A model's license is shown before its first use. Models whose license forbids commercial use are marked <i>Non-commercial</i>.</li>
      </ul>
    ),
  },
  {
    id: "privacy",
    icon: ShieldCheck,
    title: "Privacy and safety",
    body: (
      <p>
        Everything runs on your Mac. Prism never uploads audio; the only network access is the model catalog when you open it. Models are only run as ONNX
        files, which can't execute code — PyTorch checkpoints are refused — and downloads are verified with SHA-256 before use.
      </p>
    ),
  },
  {
    id: "trouble",
    icon: Wrench,
    title: "Troubleshooting",
    body: (
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          <b>“Not enough memory”</b> — close other apps or try a shorter song. Very long tracks need several GB.
        </li>
        <li>
          <b>“This file couldn't be read”</b> — the file may be damaged or DRM-protected. Converting it to WAV usually helps.
        </li>
        <li>
          <b>Separation seems slow</b> — check Settings → Hardware acceleration is on. Fast quality is about 3× quicker than Best.
        </li>
        <li>
          <b>Low on disk space</b> — stems are cached losslessly (about 85 MB per stem for a 4-minute song). Clear the library or the accelerator cache in
          Settings.
        </li>
      </ul>
    ),
  },
];

export function HelpView() {
  const go = useApp((s) => s.go);
  const jump = (id: string) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="mx-auto max-w-[860px] py-8">
      <PageHeader
        title="Help"
        subtitle="Everything you need to get great stems out of Prism."
        right={
          <Button size="sm" onClick={() => go("shortcuts")} tip="See every keyboard shortcut" shortcut="goShortcuts">
            Keyboard shortcuts
          </Button>
        }
      />
      <div className="grid grid-cols-[180px_1fr] gap-8">
        <nav aria-label="Help topics" className="sticky top-14 self-start">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button onClick={() => jump(s.id)} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted hover:bg-elevated hover:text-text" data-tip={`Jump to “${s.title}”`}>
                  <s.icon size={14} />
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-3">
          {SECTIONS.map((s, i) => (
            <Card key={s.id} id={`help-${s.id}`} className="scroll-mt-14 p-5">
              <h2 className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold">
                <span className={cx("flex h-6 w-6 items-center justify-center rounded-md", i === 0 ? "bg-accent text-white" : "bg-accent-soft text-accent")}>
                  <s.icon size={14} />
                </span>
                {s.title}
              </h2>
              <div className="text-[13px] leading-relaxed text-text/85 [&_b]:font-semibold [&_b]:text-text [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px]">
                {s.body}
              </div>
            </Card>
          ))}
          <p className="flex items-center justify-center gap-2 pt-3 text-[12px] text-faint">
            <LifeBuoy size={13} /> Prism is open source — report issues on GitHub (JonneNieminen/Prism).
          </p>
        </div>
      </div>
    </div>
  );
}

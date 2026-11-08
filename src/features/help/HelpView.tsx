import { ArrowDownToLine, AudioLines, Boxes, Download, Flag, Gauge, Library, LifeBuoy, Metronome, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { Button, Card, PageHeader, cx } from "../../components/ui";
import { mark } from "../../i18n";
import { Rich } from "../../i18n/Rich";
import { useT } from "../../i18n/useT";
import { useApp } from "../../store/app";

// Each item is English text with **bold**, `code` and {key:mod+O} keycaps; it is translated when shown.
type Section = { id: string; icon: typeof Flag; title: string; kind: "ol" | "ul" | "p"; items: string[] };

const SECTIONS: Section[] = [
  {
    id: "start",
    icon: Flag,
    title: mark("Getting started"),
    kind: "ol",
    items: [
      mark("Drop a song onto the **Separate** screen, or press {key:mod+O} to choose one. MP3, WAV, FLAC, M4A and OGG work."),
      mark("Check the preview, pick a model and a quality, then press **Separate** ({key:mod+↩})."),
      mark("When it's done the player opens. Mute, solo and mix the stems, then export what you need."),
    ],
  },
  {
    id: "separate",
    icon: Gauge,
    title: mark("Separating"),
    kind: "ul",
    items: [
      mark("**Fast** is quickest, **Balanced** is the recommended default and **Best** averages several passes for the cleanest result (about 3× slower)."),
      mark("The first separation with a model takes longer while your Mac optimizes the model for its hardware. That wait is one time only, and the model is cached afterwards — a 4-minute song then takes roughly 25 seconds. A fine-tuned model has several networks and can take several minutes the first time."),
      mark("The live log under the spinner says exactly what Prism is doing, step by step. You can keep browsing while it runs, and cancel any time with {key:mod+.} — it stops right away."),
      mark("Drop several songs at once, or more while one is separating, to queue them under **Up next**. They run one after another with the same model and quality, and each finished song goes to the Library with a notification to open it."),
    ],
  },
  {
    id: "download",
    icon: ArrowDownToLine,
    title: mark("Download track"),
    kind: "ul",
    items: [
      mark("Paste a link from YouTube, SoundCloud, Instagram or TikTok on the **Download track** page (or any other link a downloader can read). Prism names the platform, shows each step and saves the audio to your download folder."),
      mark("When it's done, **Separate this** loads the file straight into Separate. Change the download folder in Settings → Downloads."),
      mark("Only download what you have the right to: your own uploads, tracks with a licence that allows it, or music offered for free. Each site has its own terms. Spotify can't be downloaded — its streams are copy-protected."),
    ],
  },
  {
    id: "player",
    icon: AudioLines,
    title: mark("The player"),
    kind: "ul",
    items: [
      mark("Every stem plays in sync. Click a stem's name or its colored dot to mute it — {key:shift}-click to mute or unmute a range of stems. **S** solos a stem (solo wins over mute, like a mixing desk). Drag a stem's slider to change its volume, or scroll over it; double-click the slider to reset it. The **Master volume** slider and sound switch at the bottom of the sidebar control everything Prism plays, in every view."),
      mark("**Karaoke** removes the vocals, **A cappella** leaves only the vocals, **Reset** turns everything back on."),
      mark("With the 6-stem model (get it in Models) the guitar becomes its own stem: **No guitar** removes it and **Guitar only** keeps just the guitar, like Karaoke and A cappella. Press {key:G} to remove the guitar. Guitar is the hardest instrument to separate, so expect it to be less clean than vocals or drums."),
      mark("Click a waveform to jump there, or drag to scrub. {key:space} plays and pauses, {key:←} {key:→} skip 5 seconds and the number keys mute stems 1–9 (hold {key:shift} to solo)."),
      mark("**Loop a part** to practice it: {key:shift}-drag across a waveform, or press {key:I} at the start and {key:O} at the end. {key:L} turns the loop on and off. Every stem loops together, and Prism remembers each song's mix and loop for the next time you open it."),
    ],
  },
  {
    id: "export",
    icon: Download,
    title: mark("Exporting"),
    kind: "ul",
    items: [
      mark("**Current mix** saves exactly what you hear as one file ({key:mod+E}). **Download all stems** saves a .zip with one file per stem ({key:shift+mod+E}). The download button on a stem saves just that stem."),
      mark("WAV is 24-bit and lossless, FLAC is lossless and smaller, MP3 is smallest (128–320 kbps). Files are named like *Song Title - vocals.wav*."),
      mark("With a loop set, choose **Length → Loop** in the export dialog to save only that part."),
      mark("Set a default save folder in Settings to skip navigating every time."),
    ],
  },
  {
    id: "analyze",
    icon: Metronome,
    title: mark("Key & BPM"),
    kind: "ul",
    items: [
      mark("Open **Key & BPM** in the sidebar to find a song's tempo and musical key without separating it. Drop a song there or choose a file."),
      mark("Tempo can land on half or double time, so the alternatives are shown. The key comes with its Camelot code (for harmonic mixing) and its relative key, which shares the same notes and is the most common mix-up."),
      mark("**Separate this song** hands it straight to Separate — it's already decoded, so it starts right away."),
    ],
  },
  {
    id: "library",
    icon: Library,
    title: mark("Library"),
    kind: "p",
    items: [
      mark("Separations are kept in the Library, so reopening a song is instant — no reprocessing. Each entry remembers which model made it. To save disk space, songs are deleted automatically after 7 days; change that (or choose Never) in Settings → Storage → Delete old songs. Rename or delete entries in the Library. Your original song files are never changed or copied."),
    ],
  },
  {
    id: "models",
    icon: Boxes,
    title: mark("Models"),
    kind: "ul",
    items: [
      mark("Prism ships with **Demucs v4 (4 stems)**. The Models screen's catalog offers more: 6 stems (adds guitar and piano), a fine-tuned Demucs, two MDX-Net models specialised in vocals or instrumentals, and BS-RoFormer, the cleanest 6-stem model (large and slow, and its weights have no published licence, so it is flagged non-commercial)."),
      mark("To add your own, use **Import folder** or **Import .zip**. A model is a folder with a `model.json` and ONNX weights — see \"Adding your own model\" in the README."),
      mark("A model's license is shown before its first use. Models whose license forbids commercial use are marked *Non-commercial*."),
    ],
  },
  {
    id: "updates",
    icon: RefreshCw,
    title: mark("Updates"),
    kind: "ul",
    items: [
      mark("Prism looks for a new version when it starts and every 4 hours while it runs. When there is one, a notice appears; open **Settings → Updates** and press **Install and restart**."),
      mark("Switch the automatic check off with **Check for updates automatically**, or press **Check for updates** whenever you like. **Show release notes** lists what changed in the latest release."),
      mark("Updates come from this project's GitHub releases and are verified with a signature before they are installed."),
    ],
  },
  {
    id: "privacy",
    icon: ShieldCheck,
    title: mark("Privacy and safety"),
    kind: "p",
    items: [
      mark("Everything runs on your computer. Prism never uploads audio; it only uses the network for the model catalog when you open it, for tracks you choose to download from a link, and to check GitHub for updates. Models are only run as ONNX files, which can't execute code — PyTorch checkpoints are refused — and downloads are verified with SHA-256 before use."),
    ],
  },
  {
    id: "trouble",
    icon: Wrench,
    title: mark("Troubleshooting"),
    kind: "ul",
    items: [
      mark("**“Not enough memory”** — close other apps or try a shorter song. Very long tracks need several GB."),
      mark("**“This file couldn't be read”** — the file may be damaged or DRM-protected. Converting it to WAV usually helps."),
      mark("**Separation seems slow** — check Settings → Hardware acceleration is on. Fast quality is about 3× quicker than Best."),
      mark("**Low on disk space** — stems are cached losslessly (about 85 MB per stem for a 4-minute song). Clear the library or the accelerator cache in Settings."),
      mark("**A download doesn't start** — the site may need you to be signed in, or the track may be private or blocked in your country. Try another link."),
    ],
  },
];

export function HelpView() {
  const { t } = useT();
  const go = useApp((s) => s.go);
  const jump = (id: string) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="mx-auto max-w-[860px] py-8">
      <PageHeader
        title={t("Help")}
        subtitle={t("Everything you need to get great stems out of Prism.")}
        right={
          <Button size="sm" onClick={() => go("shortcuts")} tip={t("See every keyboard shortcut")} shortcut="goShortcuts">
            {t("Keyboard shortcuts")}
          </Button>
        }
      />
      <div className="grid grid-cols-[180px_1fr] gap-8">
        <nav aria-label={t("Help topics")} className="sticky top-14 self-start">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button onClick={() => jump(s.id)} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted hover:bg-elevated hover:text-text" data-tip={t("Jump to “{title}”", { title: t(s.title) })}>
                  <s.icon size={14} />
                  {t(s.title)}
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
                {t(s.title)}
              </h2>
              <div className="text-[13px] leading-relaxed text-text/85 [&_b]:font-semibold [&_b]:text-text [&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_em]:italic">
                {s.kind === "p" ? (
                  <p>
                    <Rich text={t(s.items[0])} />
                  </p>
                ) : s.kind === "ol" ? (
                  <ol className="list-decimal space-y-1.5 pl-5">
                    {s.items.map((it) => (
                      <li key={it}>
                        <Rich text={t(it)} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <ul className="list-disc space-y-1.5 pl-5">
                    {s.items.map((it) => (
                      <li key={it}>
                        <Rich text={t(it)} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          ))}
          <p className="flex items-center justify-center gap-2 pt-3 text-[12px] text-faint">
            <LifeBuoy size={13} /> {t("Prism is open source — report issues on GitHub (JonneNieminen/Prism).")}
          </p>
        </div>
      </div>
    </div>
  );
}

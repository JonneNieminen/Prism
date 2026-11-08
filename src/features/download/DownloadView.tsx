import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, FolderOpen, Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Link } from "../../bindings";
import { StepList } from "../../components/StepList";
import { TrackFlow } from "../../components/TrackFlow";
import { Button, Card, Chip, ProgressBar, cx } from "../../components/ui";
import { formatBytes, formatEta, formatTime } from "../../lib/format";
import { backend, toAppError } from "../../lib/ipc";
import { showInFileManager } from "../../lib/platform";
import { useApp } from "../../store/app";
import { ErrorCard } from "../import/SeparateView";
import { useDownload, type Track } from "./downloadStore";
import { mark, tr } from "../../i18n";
import { useT } from "../../i18n/useT";

const PLATFORM_NAME = { youTube: "YouTube", soundCloud: "SoundCloud", instagram: "Instagram", tikTok: "TikTok", other: mark("Link") } as const;
const platformName = (p: keyof typeof PLATFORM_NAME) => (p === "other" ? tr("Link") : PLATFORM_NAME[p]);

const STEPS = [
  { key: "check", label: mark("Check the link") },
  { key: "fetch", label: mark("Find the track") },
  { key: "download", label: mark("Download the audio") },
  { key: "save", label: mark("Save to your folder") },
] as const;

export function DownloadView() {
  const track = useDownload((s) => s.track);
  const result = useDownload((s) => s.result);
  return (
    <div className="mx-auto flex min-h-full max-w-[820px] flex-col justify-center py-10">
      <AnimatePresence mode="wait">
        <motion.div key={track ? "run" : result ? "done" : "form"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: "easeOut" }}>
          {track ? <Running track={track} /> : result ? <Finished /> : <Form />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function useFolder() {
  const dir = useApp((s) => s.settings?.trackDownloadDir);
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    void backend().then((b) => b.trackDownloadDir()).then(setFolder).catch(() => setFolder(null));
  }, [dir]);
  return folder;
}

function Form() {
  const { t } = useT();
  const url = useDownload((s) => s.url);
  const setUrl = useDownload((s) => s.setUrl);
  const start = useDownload((s) => s.start);
  const error = useDownload((s) => s.error);
  const go = useApp((s) => s.go);
  const folder = useFolder();
  const [link, setLink] = useState<Link | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Recognise the platform as the user types or pastes.
  useEffect(() => {
    if (!url.trim()) {
      setLink(null);
      setProblem(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void backend()
        .then((b) => b.classifyLink(url))
        .then((l) => alive && (setLink(l), setProblem(null)))
        .catch((e) => alive && (setLink(null), setProblem(toAppError(e).message)));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [url]);

  // Recognise the link again on submit, so pressing Enter right after a paste works.
  const submit = () => {
    if (!url.trim()) return;
    void backend()
      .then((b) => b.classifyLink(url))
      .then((l) => start(l.url, l.platform))
      .catch((e) => setProblem(toAppError(e).message));
  };

  return (
    <div>
      <div className="mb-7 text-center">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.015em]">{t("Download a track")}</h1>
        <p className="mt-2 text-[14px] text-muted">{t("Paste a link from YouTube, SoundCloud, Instagram or TikTok. Prism saves the audio, ready to separate.")}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={cx("flex items-center gap-2 rounded-xl border bg-surface px-3.5 transition-colors focus-within:border-accent", problem ? "border-danger" : "border-border-strong")}>
          <Link2 size={18} className="shrink-0 text-muted" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("https://www.youtube.com/watch?v=…")}
            aria-label={t("Link to the track")}
            aria-invalid={!!problem}
            spellCheck={false}
            autoFocus
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <AnimatePresence>
            {link && (
              <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <Chip color="var(--accent)" tip={t("Prism recognised this link")}>
                  {platformName(link.platform)}
                </Chip>
              </motion.span>
            )}
          </AnimatePresence>
          {url && (
            <button type="button" aria-label={t("Clear the link")} data-tip={t("Clear")} onClick={() => setUrl("")} className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-text">
              <X size={14} />
            </button>
          )}
        </div>
        <AnimatePresence>
          {problem && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden px-1 pt-2 text-[12px] leading-relaxed text-danger" role="alert">
              {problem}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="min-w-0 text-[12px] text-muted">
            <span>{t("Saves to")} </span>
            <button type="button" className="truncate align-bottom font-medium text-text hover:underline" onClick={() => go("settings")} data-tip={t("Change the download folder in Settings")}>
              {folder ?? t("your Downloads folder")}
            </button>
          </div>
          <Button type="submit" variant="primary" size="lg" disabled={!link} tip={link ? t("Download the audio") : t("Paste a link first")} icon={<ArrowRight size={16} />}>
            {t("Download")}
          </Button>
        </div>
      </form>

      <AnimatePresence>{error && <ErrorCard error={error} />}</AnimatePresence>

      <p className="mx-auto mt-9 max-w-[560px] text-center text-[12px] leading-relaxed text-faint">
        {t("Only download what you have the right to: your own uploads, tracks with a licence that allows it, or music the artist offers for free. Each site has its own terms, and you're responsible for following them. Spotify can't be downloaded.")}
      </p>
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function detailFor(track: Track, name: string) {
  if (track.stage === "fetch") return tr("Asking {name} for the track details", { name });
  if (track.stage === "save") return tr("Moving the file into your folder");
  const parts: string[] = [];
  if (track.doneBytes != null) parts.push(track.totalBytes ? tr("{done} of {total}", { done: formatBytes(track.doneBytes), total: formatBytes(track.totalBytes) }) : formatBytes(track.doneBytes));
  if (track.speed) parts.push(`${formatBytes(track.speed)}/s`);
  if (track.eta != null) parts.push(formatEta(track.eta).toLowerCase());
  return parts.length ? parts.join(" · ") : tr("Starting the download");
}

function Running({ track }: { track: Track }) {
  const { t } = useT();
  const cancel = useDownload((s) => s.cancel);
  const [cancelling, setCancelling] = useState(false);
  const now = useNow();
  const name = platformName(track.platform);
  const source = track.platform === "other" ? t("the link") : name;
  const current = track.stage === "fetch" ? 1 : track.stage === "download" ? 2 : 3;
  const known = track.stage === "download" && track.fraction != null;
  return (
    <div className="text-center">
      <TrackFlow stage={track.stage} fraction={track.fraction} source={source} />
      <h2 className="mt-5 truncate text-[20px] font-semibold">{track.title ?? t("Finding your track…")}</h2>
      <p className="mt-1 text-[13px] text-muted">{track.uploader ? `${track.uploader} · ${name}` : name}</p>

      <div className="mx-auto mt-7 max-w-[460px] text-left">
        <StepList
          label={t("Download steps")}
          steps={STEPS.map((x) => ({ key: x.key, label: t(x.label) }))}
          current={current}
          detail={detailFor(track, name)}
          trailing={known ? `${Math.round((track.fraction ?? 0) * 100)}%` : undefined}
        />
        <div className="mt-4">
          <ProgressBar value={track.stage === "save" ? 1 : (track.fraction ?? 0)} indeterminate={!known && track.stage !== "save"} label={t("Download progress")} />
          <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
            <span className="tabular">{t("Elapsed {time}", { time: formatTime(Math.max(0, (now - track.startedAt) / 1000)) })}</span>
          </div>
        </div>
        <div className="text-center">
          <Button
            className="mt-6"
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              void cancel();
            }}
            tip={t("Stop downloading. Nothing is saved.")}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
          <p className="mt-5 text-[12px] text-faint">{t("You can keep using Prism while this runs. We'll let you know when it's done.")}</p>
        </div>
      </div>
    </div>
  );
}

function Finished() {
  const { t } = useT();
  const result = useDownload((s) => s.result)!;
  const separate = useDownload((s) => s.separate);
  const reset = useDownload((s) => s.reset);
  const folder = result.path.replace(/[\\/][^\\/]*$/, "");
  return (
    <div className="text-center">
      <TrackFlow stage="done" fraction={1} source={t("the link")} />
      <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 18 }} className="mx-auto mt-4 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white">
        <Check size={18} strokeWidth={3} />
      </motion.div>
      <h2 className="mt-4 truncate text-[20px] font-semibold">{result.title}</h2>
      <p className="mt-1 text-[13px] text-muted">{t("Saved to {folder}", { folder })}</p>
      <Card className="mx-auto mt-7 flex max-w-[460px] flex-col gap-2 p-4">
        <Button variant="primary" size="lg" onClick={separate} disabled={!result.separable} tip={result.separable ? t("Load this track into Separate") : t("Prism can't open this file type")}>
          {t("Separate this")} <ArrowRight size={16} />
        </Button>
        {!result.separable && <p className="text-[12px] text-muted">{t("The site only offered this track in a format Prism can't separate yet. The file is saved if you want it anyway.")}</p>}
        <div className="flex gap-2">
          <Button className="flex-1" icon={<FolderOpen size={14} />} onClick={() => void backend().then((b) => b.reveal(result.path))} tip={t("Show the file in your file manager")}>
            {t(showInFileManager)}
          </Button>
          <Button className="flex-1" variant="ghost" onClick={reset} tip={t("Download another track")}>
            {t("Download another")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

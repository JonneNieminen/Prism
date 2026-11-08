import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Copy, Metronome, Music4, RotateCcw, Upload, X } from "lucide-react";
import { useState } from "react";
import type { MusicKey } from "../../bindings";
import { Waveform } from "../../components/Waveform";
import { Button, Card, Chip, IconButton, PageHeader, cx } from "../../components/ui";
import { formatTime } from "../../lib/format";
import { useApp } from "../../store/app";
import { ErrorCard } from "../import/SeparateView";

const MAJOR = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

/** C major ↔ A minor: same notes, so the estimator can confuse them. */
function relativeKey(k: MusicKey) {
  return k.minor ? `${MAJOR[(k.tonic + 3) % 12]} major` : `${MINOR[(k.tonic + 9) % 12]} minor`;
}

function confidenceLabel(c: number) {
  return c >= 0.6 ? "High confidence" : c >= 0.3 ? "Medium confidence" : "Low confidence";
}

/** Key & BPM only: no separation, just decode and estimate. */
export function AnalyzeView() {
  const analysis = useApp((s) => s.analysis);
  const analyzing = useApp((s) => s.analyzing);
  const error = useApp((s) => s.analysisError);

  return (
    <div className="mx-auto flex min-h-full max-w-[820px] flex-col justify-center py-10">
      <AnimatePresence mode="wait">
        {analyzing ? (
          <Fade key="busy">
            <Analyzing name={analyzing.split("/").pop() ?? analyzing} />
          </Fade>
        ) : analysis ? (
          <Fade key="result">
            <Result />
          </Fade>
        ) : (
          <Fade key="drop">
            <Drop />
            <AnimatePresence>{error && <ErrorCard error={error} />}</AnimatePresence>
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

function Drop() {
  const pick = useApp((s) => s.pickAnalysis);
  const over = useApp((s) => s.dragOver);
  return (
    <div>
      <PageHeader title="Key & BPM" subtitle="Find a song's tempo and musical key in seconds — without separating it." />
      <motion.button
        onClick={() => void pick()}
        aria-label="Choose a song to analyse"
        data-tip="Choose a song to analyse"
        data-shortcut="open"
        className={cx(
          "group flex h-[220px] w-full flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed transition-colors duration-150",
          over ? "border-accent bg-accent-soft" : "border-border-strong bg-surface hover:border-accent hover:bg-elevated/50",
        )}
        animate={over ? { scale: 1.01 } : { scale: 1 }}
      >
        <div className={cx("mb-4 flex h-12 w-12 items-center justify-center rounded-xl transition-colors", over ? "bg-accent text-white" : "bg-elevated text-muted group-hover:text-accent")}>
          <Upload size={22} />
        </div>
        <div className="text-[15px] font-medium">{over ? "Release to analyse" : "Drop a song here"}</div>
        <div className="mt-1 text-[13px] text-muted">
          or <span className="font-medium text-accent">choose a file</span>
        </div>
      </motion.button>
      <p className="mt-4 text-center text-[12px] text-faint">Runs on this computer. Tempo and key are estimates — check the alternatives if a value looks off.</p>
    </div>
  );
}

function Analyzing({ name }: { name: string }) {
  return (
    <Card className="flex flex-col items-center px-8 py-14 text-center">
      <div className="mb-5 flex items-end gap-1.5" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 rounded-full"
            style={{ background: `var(--stem-${["vocals", "drums", "bass", "other"][i]})` }}
            animate={{ height: [10, 30, 10] }}
            transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
          />
        ))}
      </div>
      <div className="text-[15px] font-medium">Listening to {name}…</div>
      <div className="mt-1 text-[12px] text-muted">Finding the beat and the key</div>
    </Card>
  );
}

function Result() {
  const a = useApp((s) => s.analysis)!;
  const clear = useApp((s) => s.clearAnalysis);
  const pick = useApp((s) => s.pickAnalysis);
  const separateIt = useApp((s) => s.separateAnalyzed);
  const toast = useApp((s) => s.toast);
  const [copied, setCopied] = useState(false);
  const { info, music } = a;
  const bpm = music.bpm;
  const key = music.key;
  const summary = [key ? `${key.name} (${key.camelot})` : null, bpm != null ? `${Math.round(bpm)} BPM` : null].filter(Boolean).join(" · ");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${info.title} — ${summary}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast({ tone: "error", title: "Couldn't copy to the clipboard" });
    }
  };

  return (
    <div>
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3.5 p-5 pb-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Music4 size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold">{info.title}</h2>
            <div className="mt-0.5 truncate text-[12px] text-muted">
              {[info.artist, formatTime(info.durationSecs), info.fileName].filter(Boolean).join(" · ")}
            </div>
          </div>
          <IconButton label="Clear" tip="Analyse another song" onClick={clear}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="px-5 pb-5">
          <Waveform peaks={a.peaks} color="var(--muted)" height={52} normalize />
        </div>

        <div className="grid grid-cols-2 border-t border-border">
          <div className="border-r border-border p-6">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
              <Metronome size={13} /> Tempo
            </div>
            {bpm != null ? (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="tabular font-display text-[52px] leading-none font-semibold tracking-tight">{Math.round(bpm)}</span>
                  <span className="text-[15px] text-muted">BPM</span>
                </div>
                <div className="mt-1 text-[12px] text-muted">{confidenceLabel(music.bpmConfidence)}</div>
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] text-faint">If it feels off, try</span>
                  <Chip tip="Half time">{Math.round(bpm / 2)}</Chip>
                  <Chip tip="Double time">{Math.round(bpm * 2)}</Chip>
                </div>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-muted">No steady beat found — the song may be too short, too quiet or free-tempo.</p>
            )}
          </div>
          <div className="p-6">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
              <Music4 size={13} /> Key
            </div>
            {key ? (
              <>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="font-display text-[40px] leading-none font-semibold tracking-tight">{key.name}</span>
                  <Chip color="var(--accent)" tip="Camelot wheel code, for harmonic mixing">
                    {key.camelot}
                  </Chip>
                </div>
                <div className="mt-2 text-[12px] text-muted">{confidenceLabel(key.confidence)}</div>
                <div className="mt-4 text-[12px] text-faint">
                  Relative key: <span className="text-muted">{relativeKey(key)}</span> — shares the same notes.
                </div>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-muted">No clear key — the song may be atonal, mostly drums or too short.</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <span className="text-[12px] text-faint">Analysed in {a.secs.toFixed(1)} s on this computer</span>
          <div className="flex gap-2">
            <Button size="sm" icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copy()} disabled={!summary} tip="Copy title, key and tempo">
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => void pick()} tip="Analyse a different song" shortcut="open">
              Another song
            </Button>
            <Button size="sm" variant="primary" onClick={separateIt} tip="Split this song into stems — already decoded, so it starts right away">
              Separate this song <ArrowRight size={13} />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

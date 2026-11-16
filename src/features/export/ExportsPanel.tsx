import { AlertCircle, CheckCircle2, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ProgressBar, cx, tipAttrs } from "../../components/ui";
import { backend } from "../../lib/ipc";
import { stemLabel } from "../../lib/format";
import { showInFileManager } from "../../lib/platform";
import { useT } from "../../i18n/useT";
import { useExports, type ExportJob } from "./exportStore";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Background exports with their progress, in the sidebar so they're visible from every view. */
export function ExportsPanel() {
  const { t } = useT();
  const jobs = useExports((s) => s.jobs);
  const clearFinished = useExports((s) => s.clearFinished);
  const finished = jobs.filter((j) => j.status !== "running");
  const latest = finished[0];

  return (
    <AnimatePresence initial={false}>
      {jobs.length > 0 && (
        <motion.section
          aria-label={t("Exports")}
          className="overflow-hidden px-1"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <div className="mb-1 flex h-5 items-center justify-between px-1.5">
            <span className="text-[11px] font-semibold text-muted">{t("Exports")}</span>
            {finished.length > 0 && (
              <button className="text-[11px] text-muted transition-colors hover:text-text" onClick={clearFinished} {...tipAttrs({ tip: t("Remove finished exports from the list") })}>
                {t("Clear")}
              </button>
            )}
          </div>
          <ul className="flex max-h-[188px] flex-col gap-0.5 overflow-y-auto">
            <AnimatePresence initial={false}>
              {jobs.map((j) => (
                <motion.li key={j.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <Row job={j} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <span className="sr-only" aria-live="polite">
            {latest ? `${latest.status === "done" ? t("Export complete") : t("Export failed")}: ${fileName(latest.path)}` : ""}
          </span>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function Row({ job }: { job: ExportJob }) {
  const { t } = useT();
  const cancel = useExports((s) => s.cancel);
  const retry = useExports((s) => s.retry);
  const dismiss = useExports((s) => s.dismiss);
  const what = job.what.kind === "mix" ? t("Current mix") : job.what.kind === "zip" ? t("All stems") : stemLabel(job.what.stemLabel);
  const file = fileName(job.path);
  const name = <span className="min-w-0 flex-1 truncate text-[12px] leading-4">{job.title}</span>;
  const sub = <span className="block truncate text-[11px] leading-4 text-muted">{what}</span>;
  const action = "h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-pressed hover:text-text";

  if (job.status === "running") {
    const pct = Math.floor(job.fraction * 100);
    return (
      <div className="group rounded-md px-1.5 py-1" {...tipAttrs({ tip: t("Saving {file}", { file }) })}>
        <div className="flex items-center gap-1.5">
          {name}
          <span className="tabular text-[11px] leading-4 text-muted group-focus-within:hidden group-hover:hidden">{pct}%</span>
          <button aria-label={t("Cancel export")} className={cx(action, "hidden group-focus-within:inline-flex group-hover:inline-flex")} onClick={() => void cancel(job.id)} {...tipAttrs({ tip: t("Cancel export") })}>
            <X size={12} />
          </button>
        </div>
        {sub}
        <ProgressBar value={job.fraction} label={`${t("Export progress")} · ${job.title}`} className="mt-1 h-1" />
      </div>
    );
  }

  const ok = job.status === "done";
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div className="group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-elevated/70">
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-1.5 text-left"
        onClick={() => (ok ? void backend().then((b) => b.reveal(job.path)) : retry(job.id))}
        {...tipAttrs({ tip: ok ? `${t(showInFileManager)} · ${file}` : `${t("Export failed")}: ${job.error ?? ""}` })}
      >
        <Icon size={14} className={cx("shrink-0", ok ? "text-success" : "text-danger")} aria-label={ok ? t("Export complete") : t("Export failed")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] leading-4">{job.title}</span>
          {sub}
        </span>
      </button>
      {!ok && (
        <button aria-label={t("Try again")} className={cx(action, "inline-flex")} onClick={() => retry(job.id)} {...tipAttrs({ tip: t("Try again") })}>
          <RotateCcw size={11} />
        </button>
      )}
      <button aria-label={t("Dismiss")} className={cx(action, "inline-flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")} onClick={() => dismiss(job.id)} {...tipAttrs({ tip: t("Dismiss") })}>
        <X size={12} />
      </button>
    </div>
  );
}

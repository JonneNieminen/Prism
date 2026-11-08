import { AnimatePresence, motion } from "motion/react";
import { useT } from "../i18n/useT";

export type LogLine = { id: number; t: number; level: "info" | "warn"; text: string };

const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;

const LINE = 20;

/**
 * A live feed of what Prism is doing under the hood, centred under the spinner. New lines rise in
 * from below and push older ones up as they fade out. The height is fixed so lines arriving never
 * move the rest of the screen. Set in Prism's own font, like everything else.
 */
export function ActivityLog({ lines, lineCount = 6 }: { lines: LogLine[]; lineCount?: number }) {
  const { t } = useT();
  const shown = lines.slice(-lineCount);
  return (
    <div
      role="log"
      aria-label={t("What Prism is doing")}
      aria-live="off"
      className="mx-auto flex w-full max-w-[680px] flex-col items-center justify-end overflow-hidden px-4 text-center text-[12px]"
      style={{ height: lineCount * LINE }}
    >
      <AnimatePresence initial={false}>
        {shown.map((l, i) => {
          const age = shown.length - 1 - i; // 0 = newest
          const warn = l.level === "warn";
          return (
            <motion.div
              key={l.id}
              layout
              initial={{ opacity: 0, y: LINE }}
              animate={{ opacity: age === 0 ? 1 : Math.max(0.18, 0.62 - (age - 1) * 0.13), y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="flex w-full items-center justify-center gap-2 whitespace-nowrap"
              style={{ height: LINE }}
            >
              {warn && <span className="shrink-0 rounded-sm bg-[var(--warning)] px-1 text-[10px] font-semibold leading-[14px] tracking-wide text-[var(--bg)]">{t("WARN")}</span>}
              <span className="tabular shrink-0 text-faint">{clock(l.t)}</span>
              <span className={warn ? "min-w-0 truncate text-warning" : age === 0 ? "min-w-0 truncate text-text" : "min-w-0 truncate text-muted"}>{l.text}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

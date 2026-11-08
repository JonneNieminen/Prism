import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Spinner, cx } from "./ui";

/**
 * The "what's happening" checklist shared by separating and downloading: finished steps get a
 * check, the current one a spinner and a live detail line, later ones are dimmed.
 * `current` past the last step means everything is done.
 */
export function StepList({
  steps,
  current,
  detail,
  trailing,
  label,
}: {
  steps: readonly { key: string; label: string }[];
  current: number;
  /** Plain-words line under the current step. */
  detail?: string | null;
  /** Right-aligned text on the current step (a percentage, an elapsed time). */
  trailing?: ReactNode;
  label: string;
}) {
  return (
    <ol className="card divide-y divide-[var(--border)] overflow-hidden" aria-label={label}>
      {steps.map((st, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={st.key} aria-current={state === "active" ? "step" : undefined} className={cx("flex items-start gap-3 px-3.5 py-2.5 transition-opacity", state === "todo" && "opacity-45")}>
            <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center">
              {state === "done" ? (
                <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }} className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent text-white">
                  <Check size={11} strokeWidth={3} />
                </motion.span>
              ) : state === "active" ? (
                <Spinner className="h-[18px] w-[18px] border-2 text-accent" />
              ) : (
                <span className="h-[18px] w-[18px] rounded-full border-[1.5px] border-border-strong" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cx("text-[13px]", state === "active" ? "font-medium" : "text-muted")}>{st.label}</div>
              <AnimatePresence initial={false}>
                {state === "active" && detail && (
                  <motion.div key={st.key} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="mt-0.5 truncate text-[12px] text-muted" aria-live="polite">
                    {detail}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <span className="tabular mt-px text-[12px] text-muted">{state === "active" && trailing}</span>
          </li>
        );
      })}
    </ol>
  );
}

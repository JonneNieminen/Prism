import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useApp } from "../store/app";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-[360px] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertCircle : Info;
          const color = t.tone === "success" ? "var(--success)" : t.tone === "error" ? "var(--danger)" : "var(--muted)";
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 500, damping: 36 }}
              className="glass pointer-events-auto flex gap-3 rounded-2xl bg-glass-strong p-4 shadow-[var(--shadow)]"
              role={t.tone === "error" ? "alert" : "status"}
            >
              <Icon size={18} style={{ color }} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t.title}</div>
                {t.body && <div className="mt-0.5 text-[13px] break-words text-muted">{t.body}</div>}
                {t.action && (
                  <button
                    className="brand-text mt-2 text-[13px] font-semibold"
                    onClick={() => {
                      t.action!.run();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button aria-label="Dismiss" className="text-muted hover:text-text" onClick={() => dismiss(t.id)}>
                <X size={16} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useApp } from "../store/app";
import { useT } from "../i18n/useT";

export function Toasts() {
  const { t } = useT();
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[340px] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? AlertCircle : Info;
          const color = toast.tone === "success" ? "var(--success)" : toast.tone === "error" ? "var(--danger)" : "var(--muted)";
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="pointer-events-auto flex gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-[var(--shadow-pop)]"
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <Icon size={17} style={{ color }} className="mt-px shrink-0" />
              <div className="selectable min-w-0 flex-1">
                <div className="text-[13px] font-medium">{toast.title}</div>
                {toast.body && <div className="mt-0.5 text-[12px] break-words text-muted">{toast.body}</div>}
                {toast.action && (
                  <button
                    className="mt-1.5 text-[12px] font-medium text-accent hover:underline"
                    onClick={() => {
                      toast.action!.run();
                      dismiss(toast.id);
                    }}
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button aria-label={t("Dismiss")} data-tip={t("Dismiss")} className="h-5 w-5 rounded text-muted hover:text-text" onClick={() => dismiss(toast.id)}>
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

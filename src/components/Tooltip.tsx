import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keysFor } from "../lib/shortcuts";

type Tip = { text: string; keys?: string; rect: DOMRect; id: number };

/**
 * One tooltip for the whole app. Any element with `data-tip="…"` (and optionally
 * `data-shortcut="<command id>"`) gets an accessible, delayed tooltip on hover or
 * keyboard focus. Moving between tooltipped controls shows the next one instantly,
 * like macOS.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const visible = useRef(false);
  visible.current = !!tip;

  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;
    let lastHidden = 0;
    let seq = 0;

    const show = (el: Element) => {
      const text = el.getAttribute("data-tip");
      if (!text || !el.isConnected) return;
      const sc = el.getAttribute("data-shortcut");
      setTip({ text, keys: sc ? keysFor(sc) : undefined, rect: el.getBoundingClientRect(), id: ++seq });
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (visible.current) lastHidden = performance.now();
      current = null;
      setTip(null);
    };
    const schedule = (el: Element, delay: number) => {
      window.clearTimeout(timer);
      current = el;
      const warm = visible.current || performance.now() - lastHidden < 500;
      if (visible.current) setTip(null);
      timer = window.setTimeout(() => show(el), warm ? 0 : delay);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null;
      if (el === current) return;
      if (!el) return hide();
      schedule(el, 600);
    };
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Element | null;
      if (!t?.matches?.(":focus-visible")) return;
      const el = t.closest("[data-tip]");
      if (el) schedule(el, 250);
    };
    const opts = { capture: true } as const;
    document.addEventListener("pointerover", onOver, opts);
    document.addEventListener("pointerdown", hide, opts);
    document.addEventListener("keydown", hide, opts);
    document.addEventListener("scroll", hide, opts);
    document.addEventListener("focusin", onFocus, opts);
    document.addEventListener("focusout", hide, opts);
    window.addEventListener("blur", hide);
    document.documentElement.addEventListener("pointerleave", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver, opts);
      document.removeEventListener("pointerdown", hide, opts);
      document.removeEventListener("keydown", hide, opts);
      document.removeEventListener("scroll", hide, opts);
      document.removeEventListener("focusin", onFocus, opts);
      document.removeEventListener("focusout", hide, opts);
      window.removeEventListener("blur", hide);
      document.documentElement.removeEventListener("pointerleave", hide);
    };
  }, []);

  return createPortal(
    <AnimatePresence>{tip && <Bubble key={tip.id} tip={tip} />}</AnimatePresence>,
    document.body,
  );
}

function Bubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const r = tip.rect;
    const gap = 6;
    const below = r.bottom + gap + height < window.innerHeight - 8;
    const top = below ? r.bottom + gap : r.top - gap - height;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    setPos({ left, top, below });
  }, [tip]);

  return (
    <motion.div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[100] flex max-w-[280px] items-center gap-2 rounded-md px-2 py-[5px] text-[12px] leading-snug shadow-[var(--shadow-pop)]"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        background: "var(--tooltip-bg)",
        color: "var(--tooltip-text)",
      }}
      initial={{ opacity: 0, y: pos?.below === false ? 3 : -3 }}
      animate={{ opacity: pos ? 1 : 0, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <span>{tip.text}</span>
      {tip.keys && <span className="shrink-0 font-medium tracking-wide opacity-55">{tip.keys}</span>}
    </motion.div>
  );
}

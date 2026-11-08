import { motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { stemColor, withAlpha } from "../lib/colors";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Tooltip props: `tip` (text) and `shortcut` (command id → keycaps). See Tooltip.tsx. */
export type TipProps = { tip?: string; shortcut?: string };
export const tipAttrs = ({ tip, shortcut }: TipProps) =>
  tip ? { "data-tip": tip, ...(shortcut ? { "data-shortcut": shortcut } : {}) } : {};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  TipProps & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    icon?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, tip, shortcut, ...rest },
  ref,
) {
  const sizes = {
    sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-md",
    md: "h-8 px-3.5 text-[13px] gap-1.5 rounded-lg",
    lg: "h-10 px-5 text-[14px] gap-2 rounded-lg",
  };
  const variants = {
    primary: "bg-accent text-[var(--accent-text)] hover:bg-accent-hover active:brightness-95",
    secondary: "bg-elevated text-text border border-border hover:bg-pressed",
    ghost: "text-muted hover:text-text hover:bg-elevated",
    danger: "bg-elevated text-danger border border-border hover:bg-pressed",
  };
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40",
        sizes[size],
        variants[variant],
        className,
      )}
      {...tipAttrs({ tip, shortcut })}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  active,
  className,
  children,
  shortcut,
  tip,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean } & TipProps) {
  return (
    <button
      aria-label={label}
      className={cx(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-35",
        active && "bg-elevated text-text",
        className,
      )}
      {...tipAttrs({ tip: tip ?? label, shortcut })}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  full = false,
}: {
  value: T;
  options: { value: T; label: ReactNode; tip?: string; shortcut?: string; disabled?: boolean; aria?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  full?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("rounded-lg bg-pressed p-0.5", full ? "flex" : "inline-flex")}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            aria-label={o.aria}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            {...tipAttrs({ tip: o.tip, shortcut: o.shortcut })}
            className={cx(
              "relative inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors disabled:opacity-35",
              full && "flex-1",
              size === "sm" ? "h-6 px-2.5 text-[12px]" : "h-7 px-3 text-[12px]",
              on ? "text-text" : "text-muted hover:text-text",
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${label}`}
                className="absolute inset-0 rounded-md bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.18),0_0_0_0.5px_var(--border)]"
                transition={{ type: "spring", stiffness: 600, damping: 45 }}
              />
            )}
            <span className="relative inline-flex items-center gap-1">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, tip }: { checked: boolean; onChange: (v: boolean) => void; label: string; tip?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      {...tipAttrs({ tip })}
      className={cx("relative h-[22px] w-[38px] rounded-full transition-colors duration-150", checked ? "bg-accent" : "bg-pressed")}
    >
      <motion.span
        className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)]"
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: "spring", stiffness: 700, damping: 40 }}
      />
    </button>
  );
}

export function Chip({ children, color, className, tip }: { children: ReactNode; color?: string; className?: string; tip?: string }) {
  return (
    <span
      {...tipAttrs({ tip })}
      className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-[11px] font-medium", className)}
      style={color ? { color, background: withAlpha(color, 0.13) } : { background: "var(--elevated)", color: "var(--muted)" }}
    >
      {children}
    </span>
  );
}

export function StemChip({ id, label, color }: { id: string; label: string; color?: string | null }) {
  const c = stemColor(id, color);
  return (
    <Chip color={c}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {label}
    </Chip>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function ProgressBar({ value, className, label, indeterminate = false }: { value: number; className?: string; label?: string; indeterminate?: boolean }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
      className={cx("h-1.5 overflow-hidden rounded-full bg-pressed", className)}
    >
      {indeterminate ? (
        <motion.div
          key="indeterminate"
          className="h-full w-1/3 rounded-full bg-accent"
          animate={{ x: ["-100%", "300%"] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
        />
      ) : (
      <motion.div
        key="determinate"
        className="h-full rounded-full bg-accent"
        initial={false}
        animate={{ width: `${Math.max(1.5, value * 100)}%` }}
        transition={{ type: "tween", ease: "easeOut", duration: 0.3 }}
      />
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent", className)}
    />
  );
}

/** 1–5 segments, used for speed / quality hints. */
export function Meter({ value, label }: { value: number; label: string }) {
  const words = ["", "very low", "low", "medium", "high", "very high"];
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-muted" aria-label={`${label}: ${value} of 5`} data-tip={`${label}: ${words[value]}`}>
      {label}
      <span className="inline-flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx("h-1 w-2.5 rounded-full", i <= value ? "bg-accent" : "bg-pressed")} />
        ))}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[5px] border border-border bg-surface px-1.5 font-sans text-[11px] font-medium text-muted shadow-[0_1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) =>
        k === "–" ? (
          <span key={i} className="text-faint">
            –
          </span>
        ) : (
          <Kbd key={i}>{k}</Kbd>
        ),
      )}
    </span>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div className="min-w-0">
        <h1 className="truncate font-display text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <div className="mt-1 text-[13px] text-muted">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{children}</h2>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-8 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 truncate text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

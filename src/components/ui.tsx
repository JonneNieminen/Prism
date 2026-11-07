import { motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { stemColor, withAlpha } from "../lib/colors";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, ...rest },
  ref,
) {
  const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-[15px] gap-2.5" };
  const variants = {
    primary:
      "brand-gradient text-white shadow-[0_8px_30px_-8px_var(--brand-to)] hover:brightness-110 hover:shadow-[0_10px_36px_-8px_var(--brand-to)]",
    secondary: "bg-elevated text-text border border-hairline hover:border-border hover:bg-[color-mix(in_oklab,var(--elevated)_80%,var(--text)_6%)]",
    ghost: "text-muted hover:text-text hover:bg-elevated",
    danger: "bg-elevated text-danger border border-hairline hover:border-danger/60",
  };
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-xl font-medium transition-[filter,background,border,box-shadow,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        sizes[size],
        variants[variant],
        className,
      )}
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
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40",
        active && "bg-elevated text-text",
        className,
      )}
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
}: {
  value: T;
  options: { value: T; label: string; hint?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-hairline bg-surface p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative rounded-lg font-medium transition-colors disabled:opacity-35",
              size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-4 text-[13px]",
              on ? "text-text" : "text-muted hover:text-text",
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${label}`}
                className="absolute inset-0 rounded-lg border border-hairline bg-elevated shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-6 w-10 rounded-full border border-hairline transition-colors",
        checked ? "brand-gradient" : "bg-elevated",
      )}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full bg-white shadow"
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: "spring", stiffness: 600, damping: 35 }}
      />
    </button>
  );
}

export function Chip({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", className)}
      style={
        color
          ? { color, borderColor: withAlpha(color, 0.35), background: withAlpha(color, 0.1) }
          : { borderColor: "var(--hairline)", color: "var(--muted)" }
      }
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
    <div className={cx("glass rounded-[var(--radius-card)] shadow-[var(--shadow)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className={cx("h-2 overflow-hidden rounded-full bg-elevated", className)}
    >
      <motion.div
        className="brand-gradient h-full rounded-full"
        initial={false}
        animate={{ width: `${Math.max(2, value * 100)}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 24 }}
      />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}

/** 1–5 dots, used for speed / quality hints. */
export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" aria-label={`${label}: ${value} of 5`}>
      {label}
      <span className="inline-flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cx("h-1.5 w-3 rounded-full", i <= value ? "brand-gradient" : "bg-border")} />
        ))}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-hairline bg-elevated px-1.5 font-sans text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div>
        <h1 className="font-display text-[28px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[13px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

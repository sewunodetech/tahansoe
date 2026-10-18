import type { ButtonHTMLAttributes, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "brand" | "ghost" | "danger";

type Size = "md" | "lg" | "sm" | "icon";

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors",
        size === "md" && "h-10 px-4",
        size === "lg" && "h-11 px-6",
        size === "sm" && "h-9 px-3",
        size === "icon" && "h-8 w-8",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "primary" && "bg-accent text-accent-ink hover:bg-accent-hover",
        variant === "brand" && "bg-brand text-accent-ink hover:bg-brand-dim",
        variant === "ghost" && "border border-line-strong text-ink-2 hover:bg-bg-hover hover:text-ink",
        variant === "danger" && "border border-danger-line bg-danger-bg text-danger hover:border-danger",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-line bg-bg-elevated", className)}>{children}</div>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3", className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "safe" | "warning" | "danger" | "brand" | "gold";
  className?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <Label>{label}</Label>
      <div
        className={cx(
          "mt-1 text-xl font-semibold tabular truncate",
          tone === "safe" && "text-safe",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          tone === "brand" && "text-brand",
          tone === "gold" && "text-gold",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-3 tabular">{sub}</div>}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "safe" | "warning" | "danger" | "brand" }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider",
        tone === "neutral" && "border-line-strong text-ink-3",
        tone === "safe" && "border-safe-line bg-safe-bg text-safe",
        tone === "warning" && "border-warning-line bg-warning-bg text-warning",
        tone === "danger" && "border-danger-line bg-danger-bg text-danger",
        tone === "brand" && "border-brand-dim/50 bg-brand-bg text-brand",
      )}
    >
      {children}
    </span>
  );
}

/** Range input whose filled track follows the value. */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      className="w-full"
      style={{ ["--fill" as string]: `${fill}%` }}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Explainer({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-bg-subtle p-4">
      <div className="text-sm font-medium text-ink">{title}</div>
      <div className="mt-1.5 text-sm leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors select-none",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border)]",
        secondary:
          "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border border-[var(--border)]",
        brand:
          "bg-[var(--brand-bg)] text-[var(--brand)] border border-[var(--brand-glow)]",
        safe:
          "bg-[var(--safe-bg)] text-[var(--safe)] border border-[var(--safe-border)]",
        watch:
          "bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning-border)]",
        warning:
          "bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning-border)]",
        critical:
          "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger-border)]",
        danger:
          "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger-border)]",
        outline:
          "bg-transparent text-[var(--text-secondary)] border border-[var(--border)]",
      },
      size: {
        sm: "text-[11px] px-2 py-0.5",
        md: "text-xs px-2.5 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, size, dot, children, ...props }: BadgeProps) {
  const dotColor = {
    default: "bg-[var(--text-tertiary)]",
    secondary: "bg-[var(--text-tertiary)]",
    brand: "bg-[var(--brand)]",
    safe: "bg-[var(--safe)]",
    watch: "bg-[var(--warning)]",
    warning: "bg-[var(--warning)]",
    critical: "bg-[var(--danger)]",
    danger: "bg-[var(--danger)]",
    outline: "bg-[var(--text-secondary)]",
  }[variant ?? "default"];

  return (
    <span className={cn(badgeVariants({ variant, size, className }))} {...props}>
      {dot && (
        <span
          className={cn("size-1.5 rounded-full shrink-0", dotColor)}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

export { badgeVariants };

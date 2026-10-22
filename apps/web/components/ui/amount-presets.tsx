import * as React from "react";
import { cn } from "@/lib/utils";

export interface AmountPreset<T> {
  label: string;
  value: T;
  /** Shown as a tooltip, e.g. how the value was derived. */
  hint?: string;
}

export interface AmountPresetsProps<T> {
  presets: AmountPreset<T>[];
  /** Highlights the preset whose value equals the current input. */
  current?: T;
  onSelect: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Row of quick-fill chips above an amount input (Recommended, 25%, 50%, Max, …),
 * so the user never has to guess a number.
 */
export function AmountPresets<T>({ presets, current, onSelect, disabled, className }: AmountPresetsProps<T>) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {presets.map((p) => {
        const active = current !== undefined && p.value === current;
        return (
          <button
            key={p.label}
            type="button"
            title={p.hint}
            disabled={disabled}
            onClick={() => onSelect(p.value)}
            className={cn(
              "h-6 px-2.5 rounded-full border text-[11px] font-mono transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
              active
                ? "border-[var(--brand)] bg-[var(--brand-bg)] text-[var(--brand)]"
                : "border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number | string;
  onChange: (val: number) => void;
  onValueChange?: (val: string) => void;
  token?: string;
  onMax?: () => void;
  min?: number;
  max?: number;
  step?: number;
  error?: boolean;
}

/**
 * Morpho numeric / token input.
 * Supports token badges, MAX action button, increment controls, and step validation.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      className,
      value,
      onChange,
      onValueChange,
      token,
      onMax,
      min,
      max,
      step = 0.01,
      error,
      disabled,
      ...props
    },
    ref
  ) => {
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Accept a decimal comma (Indonesian keyboards) but always display a dot.
      const raw = e.target.value.replace(",", ".");
      onValueChange?.(raw);
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) {
        onChange(parsed);
      } else if (raw === "" || raw === ".") {
        onChange(0);
      }
    };

    return (
      <div
        className={cn(
          "relative flex items-center w-full rounded-lg border bg-[var(--bg-subtle)] transition-colors px-3 py-1.5",
          error
            ? "border-[var(--danger)] focus-within:ring-1 focus-within:ring-[var(--danger)]"
            : "border-[var(--border)] focus-within:border-[var(--brand)] focus-within:ring-1 focus-within:ring-[var(--brand)]",
          disabled && "opacity-50 cursor-not-allowed bg-[var(--bg)]",
          className
        )}
      >
        <input
          ref={ref}
          // type="text" + inputMode: type="number" renders in the OS locale ("1,3"); the app formats en-US.
          type="text"
          inputMode="decimal"
          value={value === 0 && props.placeholder ? "" : value}
          onChange={handleInputChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="w-full bg-transparent text-sm font-mono tabular-nums text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] outline-none border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          {...props}
        />

        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {onMax && !disabled && (
            <button
              type="button"
              onClick={onMax}
              className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border border-[var(--brand-glow)] text-[var(--brand)] bg-[var(--brand-bg)] hover:brightness-110 cursor-pointer uppercase transition-colors"
            >
              MAX
            </button>
          )}
          {token && (
            <span className="font-mono text-xs font-semibold text-[var(--text-secondary)] select-none">
              {token}
            </span>
          )}
        </div>
      </div>
    );
  }
);
NumberInput.displayName = "NumberInput";

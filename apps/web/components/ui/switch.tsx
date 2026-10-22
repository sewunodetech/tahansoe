"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: "sm" | "md";
}

/**
 * Morpho toggle switch.
 * Accessible toggle control using brand blue for the active state.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked = false,
      onCheckedChange,
      size = "md",
      disabled,
      ...props
    },
    ref
  ) => {
    const isSm = size === "sm";

    const handleClick = () => {
      if (disabled) return;
      onCheckedChange?.(!checked);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onCheckedChange?.(!checked);
      }
    };

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
          "disabled:cursor-not-allowed disabled:opacity-40",
          checked
            ? "bg-[var(--brand)]"
            : "bg-[var(--bg-overlay)] border border-[var(--border)]",
          isSm ? "h-4 w-7 p-0.5" : "h-5 w-9 p-0.5",
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none block rounded-full bg-white shadow-sm transition-transform duration-150 ease-in-out",
            isSm ? "size-3" : "size-4",
            checked
              ? isSm
                ? "translate-x-3"
                : "translate-x-4"
              : "translate-x-0"
          )}
        />
      </button>
    );
  }
);
Switch.displayName = "Switch";

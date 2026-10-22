import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  prefixElement?: React.ReactNode;
  suffixElement?: React.ReactNode;
}

/**
 * Morpho styled text input.
 * Token-based surface-2 background, subtle hairline border, brand focus ring.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error, prefixElement, suffixElement, disabled, ...props }, ref) => {
    return (
      <div
        className={cn(
          "relative flex items-center w-full rounded-lg border bg-[var(--bg-subtle)] transition-colors",
          error
            ? "border-[var(--danger)] focus-within:ring-1 focus-within:ring-[var(--danger)]"
            : "border-[var(--border)] focus-within:border-[var(--brand)] focus-within:ring-1 focus-within:ring-[var(--brand)]",
          disabled && "opacity-50 cursor-not-allowed bg-[var(--bg)]",
          className
        )}
      >
        {prefixElement && (
          <div className="pl-3 pr-1 text-[var(--text-tertiary)] flex items-center pointer-events-none select-none">
            {prefixElement}
          </div>
        )}
        <input
          ref={ref}
          type={type}
          disabled={disabled}
          className={cn(
            "w-full bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)]",
            "outline-none disabled:cursor-not-allowed border-none",
            prefixElement && "pl-1.5",
            suffixElement && "pr-1.5"
          )}
          {...props}
        />
        {suffixElement && (
          <div className="pr-3 pl-1 text-[var(--text-tertiary)] flex items-center">
            {suffixElement}
          </div>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

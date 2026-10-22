"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Morpho button primitive.
 * Variants: primary (brand blue), secondary, outline, ghost, danger/destructive, link.
 * Sizes: sm (32px), md/default (40px), lg (44px), icon, icon-sm.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-all duration-150 outline-none select-none cursor-pointer disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[linear-gradient(120deg,#1f7bff_0%,#3aa0ff_50%,#7d6bff_100%)] text-white hover:brightness-110 active:brightness-95 shadow-[0_8px_20px_-8px_rgba(31,123,255,0.55),inset_0_1px_0_rgba(255,255,255,0.3)] border border-transparent",
        default:
          "bg-[linear-gradient(120deg,#1f7bff_0%,#3aa0ff_50%,#7d6bff_100%)] text-white hover:brightness-110 active:brightness-95 shadow-[0_8px_20px_-8px_rgba(31,123,255,0.55),inset_0_1px_0_rgba(255,255,255,0.3)] border border-transparent",
        secondary:
          "bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] active:bg-[var(--bg-overlay)]",
        outline:
          "bg-transparent text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]",
        ghost:
          "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
        danger:
          "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger-border)] hover:bg-[var(--danger)] hover:text-white transition-colors",
        destructive:
          "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger-border)] hover:bg-[var(--danger)] hover:text-white transition-colors",
        link:
          "bg-transparent text-[var(--brand)] underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-xs gap-1.5 rounded-full [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-10 px-4 text-sm gap-2 rounded-full [&_svg:not([class*='size-'])]:size-4",
        default: "h-10 px-4 text-sm gap-2 rounded-full [&_svg:not([class*='size-'])]:size-4",
        lg: "h-11 px-5 text-base gap-2.5 rounded-full [&_svg:not([class*='size-'])]:size-5",
        icon: "size-10 rounded-full p-0 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 rounded-full p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-11 rounded-full p-0 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };

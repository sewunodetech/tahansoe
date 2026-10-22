"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};

function useMounted() {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export interface ThemeToggleProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  showLabel?: boolean;
}

/**
 * Morpho-style theme toggle (dark <-> light).
 * Persists theme in localStorage via next-themes with data-theme on <html>.
 */
export function ThemeToggle({ className, showLabel = false, ...props }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  const currentTheme = theme ?? resolvedTheme ?? "light";
  const isDark = currentTheme === "dark";

  const toggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted ? `Switch to ${isDark ? "light" : "dark"} theme` : "Toggle theme"}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg border border-[var(--border)]",
        "bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
        "transition-colors text-xs font-medium cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--brand)]",
        className
      )}
      {...props}
    >
      <span className="relative flex items-center justify-center size-4 shrink-0">
        {mounted ? (
          isDark ? (
            <Moon className="size-3.5 transition-transform" />
          ) : (
            <Sun className="size-3.5 transition-transform" />
          )
        ) : (
          <span className="size-3.5 rounded-full bg-[var(--text-tertiary)] opacity-30" />
        )}
      </span>
      {showLabel && (
        <span className="capitalize">{mounted ? currentTheme : "Theme"}</span>
      )}
    </button>
  );
}

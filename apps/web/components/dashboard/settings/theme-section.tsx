"use client";

import React, { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const emptySubscribe = () => () => {};

export function ThemeSection() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const currentTheme = theme ?? resolvedTheme ?? "dark";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Appearance & Theme</CardTitle>
          <CardDescription>
            Morpho design system palette with dark-first contrast and light mode support
          </CardDescription>
        </div>
        <ThemeToggle showLabel />
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Dark Option */}
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
              mounted && currentTheme === "dark"
                ? "bg-[var(--item-active-bg)] border-[var(--brand)] shadow-xs"
                : "bg-[var(--bg-subtle)] border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="size-7 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center">
                <Moon className="size-3.5 text-[var(--brand)]" />
              </div>
              {mounted && currentTheme === "dark" && (
                <div className="size-4 rounded-full bg-[var(--brand)] flex items-center justify-center text-white">
                  <Check className="size-2.5" strokeWidth={3} />
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Dark Theme (Default)</p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                Neutral 950 deep surface with high-contrast typography
              </p>
            </div>
          </button>

          {/* Light Option */}
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
              mounted && currentTheme === "light"
                ? "bg-[var(--item-active-bg)] border-[var(--brand)] shadow-xs"
                : "bg-[var(--bg-subtle)] border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="size-7 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center">
                <Sun className="size-3.5 text-[var(--warning)]" />
              </div>
              {mounted && currentTheme === "light" && (
                <div className="size-4 rounded-full bg-[var(--brand)] flex items-center justify-center text-white">
                  <Check className="size-2.5" strokeWidth={3} />
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">Light Theme</p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                Neutral 050 crisp surface with sharp tabular clarity
              </p>
            </div>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

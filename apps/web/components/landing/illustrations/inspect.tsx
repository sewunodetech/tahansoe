"use client";

import * as React from "react";
import { createContext, useContext, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { pathThrough, type P3 } from "../geo/iso";

export type InspectItem = { id: string; title: string; body: string };

const Ctx = createContext<{ active: string; set: (id: string) => void } | null>(null);

/**
 * Makes an illustration explorable: every <Hot> part inside can be hovered,
 * focused, or tapped, and the card underneath explains it in plain words.
 */
export function Inspectable({ items, children }: { items: InspectItem[]; children: React.ReactNode }) {
  const [active, setActive] = useState(items[0]!.id);
  const item = items.find((i) => i.id === active) ?? items[0]!;

  return (
    <Ctx.Provider value={{ active, set: setActive }}>
      <div className="inspect-scene">
        {children}
        <div className="mt-3">
          <div role="tablist" aria-label="Parts of this illustration" className="flex flex-wrap justify-center gap-1.5">
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                role="tab"
                aria-selected={i.id === active}
                onClick={() => setActive(i.id)}
                onMouseEnter={() => setActive(i.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors duration-200 ${
                  i.id === active
                    ? "border-[var(--brand)] text-[var(--text-primary)] bg-[var(--bg-elevated)]"
                    : "border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {i.title}
              </button>
            ))}
          </div>
          <div className="mt-3 min-h-[84px]" role="tabpanel" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.16 }}
                className="glass-surface rounded-[16px] px-4 py-3"
              >
                <p className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--brand)]">{item.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">{item.body}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Ctx.Provider>
  );
}

/** One explorable part of an SVG scene. */
export function Hot({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const ctx = useContext(Ctx);
  if (!ctx) return <>{children}</>;
  const on = ctx.active === id;
  const select = () => ctx.set(id);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Explain ${label}`}
      aria-pressed={on}
      data-active={on || undefined}
      onClick={select}
      onMouseEnter={select}
      onFocus={select}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      }}
      className="lab-hot inspect-hot"
      style={{ cursor: "pointer", outline: "none" }}
    >
      {children}
    </g>
  );
}

/** Invisible wide stroke so thin flow lines are easy to point at. */
export function HitPath({ from, to, lift = 40 }: { from: P3; to: P3; lift?: number }) {
  return <path d={pathThrough(from, to, lift)} fill="none" stroke="transparent" strokeWidth={22} pointerEvents="stroke" />;
}

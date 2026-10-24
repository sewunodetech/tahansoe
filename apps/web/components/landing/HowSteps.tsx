"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MiniIcon, type MiniKind } from "./illustrations/MiniIcon";

export type HowStep = { icon: MiniKind; title: string; body: string; details: string[] };

/** Setup steps; pick one to see exactly what happens at that point. */
export function HowSteps({ steps }: { steps: HowStep[] }) {
  const [active, setActive] = useState(0);
  const s = steps[active]!;

  return (
    <>
      <ol className="relative mt-14 grid grid-cols-2 lg:grid-cols-4 gap-8">
        <div
          aria-hidden="true"
          className="hidden lg:block absolute top-[52px] left-[12%] right-[12%] border-t border-dashed border-[var(--border-strong)]"
        />
        {steps.map((step, i) => {
          const on = i === active;
          return (
            <li key={step.title} className="relative">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                className="group w-full flex flex-col items-center text-center outline-none"
              >
                <span
                  className={`glass-surface rounded-full size-[104px] flex items-center justify-center transition-[transform,box-shadow] duration-300 ${
                    on ? "scale-105 shadow-[0_0_0_2px_var(--brand)]" : "group-hover:scale-[1.03] group-focus-visible:shadow-[0_0_0_2px_var(--brand)]"
                  }`}
                >
                  <MiniIcon kind={step.icon} className="size-20" />
                </span>
                <span className={`mt-5 text-[11px] font-mono ${on ? "text-[var(--brand)]" : "text-[var(--text-tertiary)]"}`}>0{i + 1}</span>
                <span className="mt-1 text-[16px] font-semibold uppercase tracking-[0.02em] text-[var(--text-primary)]">{step.title}</span>
                <span className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-secondary)] max-w-[240px]">{step.body}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-10 max-w-[720px] mx-auto min-h-[150px]" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="glass-surface rounded-[20px] p-5 sm:p-6"
          >
            <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--brand)]">
              Step {active + 1} · {s.title}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {s.details.map((d) => (
                <li key={d} className="flex gap-3 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[image:var(--iridescent)]" />
                  {d}
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}

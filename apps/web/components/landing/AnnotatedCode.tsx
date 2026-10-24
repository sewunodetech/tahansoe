"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export type CodeLine = { code: string; note?: string };

/** Contract excerpt where each meaningful line explains itself on hover, focus, or tap. */
export function AnnotatedCode({ lines }: { lines: CodeLine[] }) {
  const first = lines.findIndex((l) => l.note);
  const [active, setActive] = useState(first);
  const note = lines[active]?.note;

  return (
    <div className="grid md:grid-cols-[1fr_260px]">
      <pre className="p-4 sm:p-5 overflow-x-auto font-mono text-[12px] leading-[1.7]">
        {lines.map((line, i) => {
          const hot = Boolean(line.note);
          const on = i === active;
          return (
            <div
              key={i}
              {...(hot && {
                role: "button",
                tabIndex: 0,
                "aria-label": `Explain line ${i + 1}`,
                "aria-pressed": on,
                onMouseEnter: () => setActive(i),
                onFocus: () => setActive(i),
                onClick: () => setActive(i),
              })}
              className={`flex -mx-2 px-2 rounded-md transition-colors duration-150 outline-none ${
                hot ? "cursor-pointer hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]" : ""
              } ${on ? "bg-[color-mix(in_srgb,var(--brand)_14%,transparent)]" : ""}`}
            >
              <span className={`w-8 shrink-0 select-none ${on ? "text-[var(--brand)]" : "text-[var(--text-placeholder)]"}`}>
                {i + 1}
              </span>
              <span className={`whitespace-pre ${on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                {line.code}
              </span>
            </div>
          );
        })}
      </pre>
      <div className="border-t md:border-t-0 md:border-l border-[var(--border)] p-5 min-h-[140px]" aria-live="polite">
        <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
          Line {active + 1} in plain words
        </p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={active}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.15 }}
            className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-primary)]"
          >
            {note}
          </motion.p>
        </AnimatePresence>
        <p className="mt-4 text-[11.5px] text-[var(--text-tertiary)]">Hover or tap a highlighted line.</p>
      </div>
    </div>
  );
}

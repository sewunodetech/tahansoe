"use client";

import { useEffect, useRef, useState } from "react";
import { MiniIcon, type MiniKind } from "./illustrations/MiniIcon";

const STEP_MS = 2600;

/** A layer's steps played in order while on screen; hover or focus pauses, click jumps. */
export function StepTrack({ steps }: { steps: { icon: MiniKind; title: string; body: string }[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || paused) return;
    const t = setTimeout(() => setActive((n) => (n + 1) % steps.length), STEP_MS);
    return () => clearTimeout(t);
  }, [active, visible, paused, steps.length]);

  return (
    <ol
      ref={ref}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
    >
      {steps.map((s, i) => {
        const on = i === active;
        const done = i < active;
        return (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => setActive(i)}
              aria-current={on ? "step" : undefined}
              className={`relative w-full h-full overflow-hidden text-left glass-surface rounded-[20px] p-5 flex gap-4 items-start transition-[transform,opacity,box-shadow] duration-300 ${
                on ? "-translate-y-1 shadow-[0_0_0_1px_var(--brand)]" : done ? "opacity-80" : "opacity-55"
              }`}
            >
              <MiniIcon kind={s.icon} className={`size-14 shrink-0 transition-transform duration-300 ${on ? "scale-110" : ""}`} />
              <span>
                <span className="block text-[11px] font-mono text-[var(--text-tertiary)]">
                  STEP {i + 1}
                  {done && <span className="ml-1.5 text-[var(--safe)]">✓</span>}
                </span>
                <span className="mt-1 block text-[14px] font-medium text-[var(--text-primary)]">{s.title}</span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{s.body}</span>
              </span>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--border)]">
                {on && (
                  <span
                    key={`${active}-${paused}-${visible}`}
                    className={`block h-full bg-[image:var(--iridescent)] ${visible && !paused ? "step-progress" : ""}`}
                    style={{ ["--step-ms" as string]: `${STEP_MS}ms`, transform: visible && !paused ? undefined : "scaleX(0)" }}
                  />
                )}
                {done && <span className="block h-full bg-[var(--brand)] opacity-50" />}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

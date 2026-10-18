import { motion } from "motion/react";
import { TARGET_HF, TRIGGER_HF } from "../sim/constants";
import { fmtHf, hfTone } from "../sim/model";
import { cx } from "./ui";

const MIN = 0.8;
const MAX = 4.5;
const pos = (hf: number) => {
  const v = Number.isFinite(hf) ? Math.min(MAX, Math.max(MIN, hf)) : MAX;
  return ((Math.log(v) - Math.log(MIN)) / (Math.log(MAX) - Math.log(MIN))) * 100;
};

/** Log-scaled HF bar with the three lines that matter: liquidation, trigger, target. */
export function HFGauge({ hf, label = "Health factor", compact }: { hf: number; label?: string; compact?: boolean }) {
  const tone = hfTone(hf);
  const marks = [
    { v: 1, name: "Liquidation", cls: "bg-danger" },
    { v: TRIGGER_HF, name: "Trigger", cls: "bg-warning" },
    { v: TARGET_HF, name: "Target", cls: "bg-safe" },
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</span>
        <span className={cx("font-semibold tabular", compact ? "text-lg" : "text-2xl", tone === "safe" ? "text-safe" : tone === "warning" ? "text-warning" : "text-danger")}>
          {fmtHf(hf)}
        </span>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full" style={{ background: `linear-gradient(to right, var(--danger) 0%, var(--danger) ${pos(1)}%, var(--warning) ${pos(1)}%, var(--warning) ${pos(TRIGGER_HF)}%, var(--safe-border) ${pos(TRIGGER_HF)}%, var(--safe) 100%)`, opacity: 0.85 }}>
        {marks.map((m) => (
          <span key={m.name} className={cx("absolute -top-1 h-4.5 w-0.5 rounded", m.cls)} style={{ left: `${pos(m.v)}%` }} />
        ))}
        <motion.span
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-ink shadow"
          animate={{ left: `${pos(hf)}%` }}
          transition={{ type: "spring", stiffness: 160, damping: 22 }}
        />
      </div>
      {!compact && (
        <div className="relative mt-1.5 h-4 font-mono text-[10px] text-ink-3">
          {marks.map((m) => (
            <span key={m.name} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pos(m.v)}%` }}>
              {m.v.toFixed(1)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { motion, useReducedMotion } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

const protocols = [
  { name: "Aave V3", note: "Lending" },
  { name: "Morpho Blue", note: "Isolated markets" },
  { name: "Chainlink", note: "Oracle + Trigger" },
  { name: "Safe Module", note: "Non-custodial" },
  { name: "Flash loans", note: "Zero-reserve" },
];

export function ProtocolStrip() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="mt-12 pt-8 border-t border-white/[0.05]"
      initial={reduce ? undefined : { opacity: 0, y: 12 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 1.4, ease: EASE }}
    >
      <p className="font-mono text-[9px] tracking-[0.22em] uppercase text-white/20 mb-5">
        Built on
      </p>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        {protocols.map((p, i) => (
          <motion.div
            key={p.name}
            className="flex flex-col gap-0.5"
            initial={reduce ? undefined : { opacity: 0, y: 6 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 1.5 + i * 0.06, ease: EASE }}
          >
            <span className="font-mono text-[11px] text-white/60 font-medium">
              {p.name}
            </span>
            <span className="font-mono text-[9px] text-white/25">{p.note}</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

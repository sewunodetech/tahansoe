"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, AnimatePresence } from "motion/react";

// HF simulation: starts SAFE, dips toward trigger, agent intervenes, recovers
const HF_SEQUENCE: { hf: number; status: "safe" | "warning" | "critical" | "recovering"; action?: string }[] = [
  { hf: 1.82, status: "safe" },
  { hf: 1.71, status: "safe" },
  { hf: 1.58, status: "safe" },
  { hf: 1.44, status: "warning" },
  { hf: 1.36, status: "warning" },
  { hf: 1.31, status: "critical" },
  { hf: 1.30, status: "critical", action: "Trigger fired — executing repay..." },
  { hf: 1.30, status: "critical", action: "Flash loan initiated 5,400 USDC" },
  { hf: 1.30, status: "critical", action: "Aave.repay() confirmed  ✓" },
  { hf: 1.62, status: "recovering", action: "HF restored to 1.62" },
  { hf: 1.72, status: "safe" },
  { hf: 1.80, status: "safe" },
  { hf: 1.82, status: "safe" },
];

const STATUS_COLOR = {
  safe: "#22c55e",
  warning: "#eab308",
  critical: "#ef4444",
  recovering: "#22c55e",
};

const STATUS_LABEL = {
  safe: "SAFE",
  warning: "MONITOR",
  critical: "ACTING",
  recovering: "RESTORED",
};

function hfToBarPct(hf: number): number {
  // Map 1.0 → 0%, 2.0+ → 100%
  return Math.min(100, Math.max(0, (hf - 1.0) / 1.0 * 100));
}

export function HFCard() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [blockNum, setBlockNum] = useState(21_847_340);
  const [displayHF, setDisplayHF] = useState(HF_SEQUENCE[0].hf);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hfAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = HF_SEQUENCE[step];

  // Advance simulation steps
  useEffect(() => {
    if (reduce) return;
    const delays = HF_SEQUENCE.map((_, i) => (i < 6 ? 1800 : i < 9 ? 900 : 1400));
    let idx = 0;

    function advance() {
      idx = (idx + 1) % HF_SEQUENCE.length;
      setStep(idx);
      animRef.current = setTimeout(advance, delays[idx]);
    }
    animRef.current = setTimeout(advance, delays[0]);
    return () => {
      if (animRef.current) clearTimeout(animRef.current);
    };
  }, [reduce]);

  // Smooth HF number interpolation
  useEffect(() => {
    const target = current.hf;
    if (reduce) { setDisplayHF(target); return; }

    const start = displayHF;
    const diff = target - start;
    const steps = 30;
    let i = 0;

    if (hfAnimRef.current) clearInterval(hfAnimRef.current);
    hfAnimRef.current = setInterval(() => {
      i++;
      const t = i / steps;
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplayHF(parseFloat((start + diff * ease).toFixed(2)));
      if (i >= steps) {
        if (hfAnimRef.current) clearInterval(hfAnimRef.current);
        setDisplayHF(target);
      }
    }, 16);

    return () => {
      if (hfAnimRef.current) clearInterval(hfAnimRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Live block counter
  useEffect(() => {
    if (reduce) return;
    let start = Date.now();
    const initialValue = blockNum;
    blockRef.current = setInterval(() => {
      const elapsedBlocks = Math.floor((Date.now() - start) / 2000);
      setBlockNum(initialValue + elapsedBlocks);
      start = Date.now();
    }, 100);
    return () => {
      if (blockRef.current) clearInterval(blockRef.current);
    };
  }, [reduce]);

  const barPct = hfToBarPct(displayHF);
  const statusColor = STATUS_COLOR[current.status];
  const isCritical = current.status === "critical";
  
  const formatBlockNumber = (num: number) => {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  return (
    <div className="relative w-full max-w-[440px]">
      {/* Glow behind card matching status */}
      <motion.div
        className="absolute inset-0 rounded-[12px] pointer-events-none"
        animate={{ opacity: isCritical ? 0.6 : 0.2 }}
        transition={{ duration: 0.8 }}
        style={{
          background: `radial-gradient(ellipse at 50% 50%, ${statusColor}22 0%, transparent 70%)`,
          filter: "blur(20px)",
          transform: "scale(1.1)",
        }}
      />

      {/* Main card */}
      <motion.div
        className="relative rounded-[10px] border bg-[#0d0d0f] overflow-hidden"
        animate={{
          borderColor: isCritical
            ? "rgba(239,68,68,0.4)"
            : "rgba(39,39,42,1)",
        }}
        transition={{ duration: 0.5 }}
        style={{ borderWidth: 1 }}
      >
        {/* Terminal bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#27272a] bg-[#050505]/80">
          <div className="w-2 h-2 rounded-full bg-[#3f3f46]" />
          <div className="w-2 h-2 rounded-full bg-[#3f3f46]" />
          <div className="w-2 h-2 rounded-full bg-[#3f3f46]" />
          <span className="ml-2 font-mono text-[11px] text-[#52525b]">
            tahansoe-agent
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] text-[#52525b]">
              #{formatBlockNumber(blockNum)}
            </span>
            <span className="flex items-center gap-1 font-mono text-[11px]" style={{ color: statusColor }}>
              <motion.span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: statusColor }}
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              />
              {current.status === "critical" ? "acting" : "live"}
            </span>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* HF number */}
          <div>
            <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#52525b] mb-1.5">
              Health Factor
            </p>
            <div className="flex items-baseline gap-3">
              <motion.span
                className="text-[52px] font-medium leading-none tracking-[-0.03em] tabular-nums"
                style={{ color: isCritical ? "#ef4444" : "#ffffff" }}
                animate={{ color: isCritical ? "#ef4444" : "#ffffff" }}
                transition={{ duration: 0.4 }}
              >
                {displayHF.toFixed(2)}
              </motion.span>
              <motion.span
                className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-[4px]"
                animate={{
                  backgroundColor: `${statusColor}22`,
                  color: statusColor,
                }}
                transition={{ duration: 0.4 }}
              >
                {STATUS_LABEL[current.status]}
              </motion.span>
            </div>
          </div>

          {/* HF bar */}
          <div className="space-y-2">
            <div className="relative h-1.5 rounded-full bg-[#1c1c1f] overflow-hidden">
              {/* Fill */}
              <motion.div
                className="absolute left-0 top-0 h-full rounded-full"
                animate={{
                  width: `${barPct}%`,
                  backgroundColor: isCritical
                    ? "#ef4444"
                    : current.status === "warning"
                    ? "#eab308"
                    : "#ffffff",
                }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] as const }}
              />
              {/* Trigger marker */}
              <div
                className="absolute top-0 h-full w-px opacity-60"
                style={{ left: "30%", backgroundColor: "#eab308" }}
              />
            </div>
            <div className="flex justify-between font-mono text-[9px] text-[#52525b]">
              <span>1.00 liq.</span>
              <span style={{ color: "#eab308" }}>1.30 trigger</span>
              <span>2.00+</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCell label="Collateral" value="4.2 ETH" />
            <StatCell label="Debt" value="5,400 USDC" />
            <StatCell label="Protocol" value="Aave V3" />
            <StatCell label="Chain" value="Base" />
          </div>

          {/* Action log */}
          <div className="border-t border-[#1c1c1f] pt-3 min-h-[48px]">
            <AnimatePresence mode="popLayout">
              {current.action ? (
                <motion.div
                  key={current.action}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-start gap-2"
                >
                  <motion.span
                    className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: statusColor }}
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                  />
                  <span
                    className="font-mono text-[11px] leading-relaxed"
                    style={{ color: statusColor }}
                  >
                    {current.action}
                  </span>
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex gap-4"
                >
                  <span className="font-mono text-[10px] text-[#52525b]">
                    next check{" "}
                    <span className="text-[#71717a]">1 block</span>
                  </span>
                  <span className="font-mono text-[10px] text-[#52525b]">
                    last action{" "}
                    <span className="text-[#71717a]">none needed</span>
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Critical flash overlay */}
        <AnimatePresence>
          {isCritical && (
            <motion.div
              className="absolute inset-0 pointer-events-none rounded-[10px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.04, 0, 0.04, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, repeat: Infinity }}
              style={{ backgroundColor: "#ef4444" }}
            />
          )}
        </AnimatePresence>
      </motion.div>

      {/* Ghost depth card */}
      <div
        className="absolute -bottom-2 -right-2 w-full h-full rounded-[10px] border border-[#27272a]/30 bg-[#0d0d0f]/30 -z-10"
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-4 -right-4 w-full h-full rounded-[10px] border border-[#27272a]/15 bg-[#0d0d0f]/15 -z-20"
        aria-hidden="true"
      />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] bg-[#0a0a0c] px-3 py-2 border border-[#1c1c1f]">
      <p className="font-mono text-[9px] text-[#52525b] mb-0.5">{label}</p>
      <p className="font-mono text-[12px] text-[#a1a1aa] font-medium">{value}</p>
    </div>
  );
}

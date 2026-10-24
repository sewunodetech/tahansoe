"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Tag } from "../Tag";
import { LabScene, type Flash } from "./LabScene";
import { Inspector, type Part } from "./Inspector";
import {
  LAB,
  LAYER_NAMES,
  healthFactor,
  hfStatus,
  initialState,
  step,
  type HfStatus,
  type LabEvent,
  type LabState,
  type LayerIndex,
} from "./model";

const CRASH_TO = 1450;
const CRASH_MS = 7000;
const ALL_ON = [true, true, true] as const;
const NONE = [false, false, false] as const;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const fmtHf = (hf: number) => (Number.isFinite(hf) ? hf.toFixed(2) : "∞");

const STATUS: Record<HfStatus, { label: string; color: string }> = {
  safe: { label: "Safe", color: "var(--safe)" },
  warning: { label: "Near trigger", color: "var(--warning)" },
  critical: { label: "Below trigger", color: "var(--danger)" },
  liquidatable: { label: "Liquidatable", color: "var(--danger)" },
};

/** HF gauge range shown on screen. */
const G_MIN = 0.8;
const G_MAX = 2.2;
const gaugePct = (hf: number) => `${Math.min(100, Math.max(0, ((Math.min(hf, G_MAX) - G_MIN) / (G_MAX - G_MIN)) * 100))}%`;

function clockAt(t: number) {
  const m = Math.round(t * 14);
  return `03:${String(m).padStart(2, "0")}`;
}

function describe(e: LabEvent): string {
  if (e.kind === "liquidation") return `Liquidator repaid ${usd(e.amount)} and took collateral (−${usd(e.extra ?? 0)} penalty)`;
  if (e.layer === 2) return `L3 flash loan repaid ${usd(e.amount)}, swapped ${(e.extra ?? 0).toFixed(3)} ETH`;
  return `L${(e.layer ?? 0) + 1} repaid ${usd(e.amount)} from ${e.layer === 0 ? "your wallet" : "vault shares"}`;
}

export function PositionLab() {
  const [layersOn, setLayersOn] = useState<boolean[]>([...ALL_ON]);
  const [prot, setProt] = useState<LabState>(() => initialState());
  const [bare, setBare] = useState<LabState>(() => initialState());
  const [flash, setFlash] = useState<Flash>(null);
  const [clock, setClock] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [part, setPart] = useState<Part>("hf");
  const runningRef = useRef(false);

  // Refs mirror state so the animation loop always steps from the latest values.
  const protRef = useRef(prot);
  const bareRef = useRef(bare);
  const layersRef = useRef(layersOn);
  const rafRef = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((p: LabState, b: LabState) => {
    const before = protRef.current.seq;
    protRef.current = p;
    bareRef.current = b;
    setProt(p);
    setBare(b);
    const fresh = p.events.filter((e) => e.id > before);
    if (fresh.length > 0) {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      setFlash({
        layers: fresh.map((e) => (e.kind === "liquidation" ? "liquidation" : (e.layer as LayerIndex))),
        amount: fresh.reduce((sum, e) => sum + e.amount, 0),
        penalty: fresh.reduce((sum, e) => sum + (e.kind === "liquidation" ? e.extra ?? 0 : 0), 0),
        key: fresh[0].id,
      });
      // During a crash the inspector follows the action, so people see which layer just acted.
      if (runningRef.current) {
        const e = fresh[0];
        setPart(e.kind === "liquidation" ? "collateral" : (["l1", "l2", "l3"] as const)[e.layer ?? 0]);
      }
      flashTimer.current = setTimeout(() => setFlash(null), 1800);
    }
  }, []);

  const applyPrice = useCallback(
    (price: number) => {
      commit(step(protRef.current, price, layersRef.current), step(bareRef.current, price, NONE));
    },
    [commit]
  );

  const stopCrash = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    runningRef.current = false;
    setRunning(false);
  }, []);

  const crash = useCallback(() => {
    stopCrash();
    const from = protRef.current.price;
    const to = Math.min(CRASH_TO, from);
    if (from <= to) return;
    const start = performance.now();
    setRunning(true);
    runningRef.current = true;
    setPart("hf");
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / CRASH_MS);
      // Ease-in-out with a little noise so it reads like a market, not a ramp.
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const noise = t < 1 ? Math.sin(t * 38) * 22 * (1 - t) : 0;
      applyPrice(Math.max(LAB.minPrice, from + (to - from) * eased + noise));
      setClock(clockAt(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else stopCrash();
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [applyPrice, stopCrash]);

  const reset = useCallback(() => {
    stopCrash();
    setClock(null);
    setFlash(null);
    commit(initialState(), initialState());
  }, [commit, stopCrash]);

  const toggleLayer = useCallback(
    (i: LayerIndex) => {
      const next = layersRef.current.map((v, n) => (n === i ? !v : v));
      layersRef.current = next;
      setLayersOn(next);
      // Turning a layer on while HF is already low lets the rules react right away.
      commit(step(protRef.current, protRef.current.price, next), bareRef.current);
    },
    [commit]
  );

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  const hf = healthFactor(prot);
  const st = STATUS[hfStatus(hf)];
  const bareHf = healthFactor(bare);
  const bareLiquidated = bare.penalty > 0;
  const reserves = [prot.wallet / LAB.wallet, prot.vault / LAB.vault, 1];

  return (
    <section id="lab" className="relative py-20 md:py-28 overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 top-1/3 h-[60%] iridescent-glow opacity-40 pointer-events-none" />
      <div className="relative max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="max-w-2xl">
          <Tag>Position lab · try it</Tag>
          <h2 className="mt-4 font-display uppercase text-[32px] sm:text-[44px] leading-[1.08] tracking-[-0.01em] text-[var(--text-primary)]">
            <span className="font-light block">Crash the price.</span>
            <span className="font-semibold block">Watch the layers work.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-xl">
            Your Health Factor is the height of your collateral (counted at its liquidation threshold) divided by your
            debt. Point at anything in the scene to see what it is. Then drag the ETH price or run a 3 a.m. crash, and switch layers off to see what happens without them.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-8 lg:gap-10 items-start">
          {/* Scene */}
          <div className="glass-surface rounded-[24px] p-3 sm:p-5 relative">
            <div className="px-2 pt-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
              <span className={`size-1.5 rounded-full ${running ? "bg-[var(--danger)] animate-pulse" : "bg-[var(--safe)]"}`} />
              {clock ? `${clock} · ETH ${usd(prot.price)}` : `Now · ETH ${usd(prot.price)}`}
            </div>
            <LabScene state={prot} layersOn={layersOn} flash={flash} selected={part} onSelect={setPart} />
            <div className="border-t border-[var(--border)] pt-4 mt-1">
              <Inspector part={part} state={prot} layersOn={layersOn} onSelect={setPart} onToggle={toggleLayer} />
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4">
            {/* HF readout + gauge */}
            <div className="glass-surface rounded-[24px] p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">Health Factor</p>
                  <p
                    className="mt-1 font-mono text-[44px] leading-none tabular-nums transition-colors duration-300"
                    style={{ color: st.color }}
                    aria-live="polite"
                  >
                    {fmtHf(hf)}
                  </p>
                </div>
                <span
                  className="mb-1 rounded-full px-3 py-1 text-[11px] font-mono uppercase tracking-[0.06em] border transition-colors duration-300"
                  style={{ color: st.color, borderColor: st.color }}
                >
                  {st.label}
                </span>
              </div>

              <div className="relative mt-6 h-2.5 rounded-full bg-[var(--bg-subtle)] border border-[var(--border)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-200 ease-out"
                  style={{ width: gaugePct(hf), background: st.color, opacity: 0.85 }}
                />
                {[
                  { v: 1, label: "1.00 liquidation", color: "var(--danger)" },
                  { v: LAB.trigger, label: `${LAB.trigger.toFixed(2)} trigger`, color: "var(--warning)" },
                  { v: LAB.target, label: `${LAB.target.toFixed(2)} target`, color: "var(--safe)" },
                ].map((m, n) => (
                  <div key={m.v} className="absolute -top-1.5 -bottom-1.5" style={{ left: gaugePct(m.v) }}>
                    <div className="h-full w-px" style={{ background: m.color }} />
                    <span
                      className={`absolute ${n % 2 ? "-top-5" : "top-6"} -translate-x-1/2 whitespace-nowrap font-mono text-[10px]`}
                      style={{ color: m.color }}
                    >
                      {m.label}
                    </span>
                  </div>
                ))}
              </div>

              <label className="mt-12 block">
                <span className="flex justify-between text-[12px] text-[var(--text-secondary)]">
                  <span>ETH price</span>
                  <span className="font-mono tabular-nums text-[var(--text-primary)]">{usd(prot.price)}</span>
                </span>
                <input
                  type="range"
                  min={LAB.minPrice}
                  max={LAB.maxPrice}
                  step={10}
                  value={Math.round(prot.price)}
                  onChange={(e) => {
                    stopCrash();
                    applyPrice(Number(e.target.value));
                  }}
                  className="lab-range mt-2 w-full"
                  aria-label="ETH price"
                />
              </label>

              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={crash} disabled={running} className="btn-iridescent !h-10 disabled:opacity-60">
                  {running ? "Crashing…" : "Run a 3 a.m. crash"}
                </button>
                <button type="button" onClick={reset} className="btn-ghost-soft !h-10">
                  Reset
                </button>
              </div>
            </div>

            {/* Layers */}
            <div className="glass-surface rounded-[24px] p-2">
              {LAYER_NAMES.map((name, n) => {
                const i = n as LayerIndex;
                const active = flash?.layers.includes(i) ?? false;
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={layersOn[i]}
                    onClick={() => toggleLayer(i)}
                    className={`w-full flex items-center gap-4 rounded-[18px] px-3 py-3 text-left transition-colors duration-200 hover:bg-[var(--bg-hover)] ${
                      active ? "bg-[var(--safe-bg)]" : ""
                    }`}
                  >
                    <span className="font-mono text-[11px] text-[var(--text-tertiary)] w-6">L{i + 1}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-medium text-[var(--text-primary)]">{name}</span>
                      <span className="mt-1.5 block h-1 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                        <span
                          className="block h-full rounded-full transition-[width] duration-500"
                          style={{
                            width: `${Math.max(0, reserves[i]) * 100}%`,
                            background: layersOn[i] ? "var(--brand)" : "var(--border-strong)",
                          }}
                        />
                      </span>
                      <span className="mt-1 block font-mono text-[10.5px] text-[var(--text-tertiary)]">
                        {i === 0 && `${usd(prot.wallet)} of ${usd(LAB.wallet)} USDC left`}
                        {i === 1 && `${usd(prot.vault)} of ${usd(LAB.vault)} in vault shares left`}
                        {i === 2 && (prot.swappedEth > 0 ? `${prot.swappedEth.toFixed(3)} ETH swapped so far` : "Swaps collateral only if L1 and L2 run out")}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 ${
                        layersOn[i] ? "bg-[var(--brand)] border-[var(--brand)]" : "bg-[var(--bg-subtle)] border-[var(--border-strong)]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-[18px] rounded-full bg-[var(--bg-elevated)] shadow transition-[left] duration-200 ${
                          layersOn[i] ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Same crash without protection */}
            <div
              className="rounded-[24px] border p-5 transition-colors duration-300"
              style={{
                borderColor: bareLiquidated ? "var(--danger-border)" : "var(--border)",
                background: bareLiquidated ? "var(--danger-bg)" : "transparent",
              }}
            >
              <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">Same price, no protection</p>
              <div className="mt-2 flex items-baseline justify-between gap-4">
                <p className="font-mono text-[22px] tabular-nums" style={{ color: STATUS[hfStatus(bareHf)].color }}>
                  HF {fmtHf(bareHf)}
                </p>
                <p className="text-[13px] text-[var(--text-secondary)] text-right">
                  {bareLiquidated ? (
                    <>
                      Liquidated · <span className="text-[var(--danger)] font-medium">−{usd(bare.penalty)}</span> penalty,{" "}
                      {(LAB.collateralEth - bare.collateral).toFixed(2)} ETH seized
                    </>
                  ) : (
                    "Not liquidated yet"
                  )}
                </p>
              </div>
            </div>

            {/* Event log */}
            <div className="min-h-[92px]">
              <ul className="flex flex-col gap-1.5">
                <AnimatePresence initial={false}>
                  {prot.events.slice(0, 3).map((e) => (
                    <motion.li
                      key={e.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex gap-3 text-[12.5px] leading-snug"
                    >
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full"
                        style={{ background: e.kind === "liquidation" ? "var(--danger)" : "var(--safe)" }}
                      />
                      <span className="text-[var(--text-secondary)]">
                        {describe(e)} <span className="font-mono text-[var(--text-tertiary)]">→ HF {fmtHf(e.hfAfter)}</span>
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {prot.events.length === 0 && (
                <p className="text-[12.5px] text-[var(--text-tertiary)]">
                  Nothing has happened yet. Layers only act when HF drops below your trigger ({LAB.trigger.toFixed(2)}).
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="mt-8 max-w-3xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          Illustrative numbers: 2 ETH collateral, {usd(LAB.startDebt)} USDC debt, liquidation threshold {LAB.lt}, trigger{" "}
          {LAB.trigger}, target {LAB.target}. Real outcomes depend on gas, oracle updates, and market liquidity. Tahansoe
          lowers the odds of liquidation; it does not guarantee against it.
        </p>
      </div>
    </section>
  );
}

/**
 * Pure simulation model. No React, no randomness without a seed — the stage
 * demo must produce the same numbers every time.
 *
 *   HF = (collateralBtc × price × liquidationThreshold) / debtUsd
 *   HF < 1.0  → liquidatable
 *   HF < TRIGGER_HF → Tahansoe emits an Intent and restores to TARGET_HF
 */

import {
  CLOSE_FACTOR,
  FLASH_LOAN_FEE,
  LIQ_PENALTY,
  LIQ_THRESHOLD,
  SWAP_SLIPPAGE,
  SWEEP_TO_DEBT,
  TARGET_HF,
  TRIGGER_HF,
  LENDER_APY,
  PROTOCOL_SPREAD,
  type ScenarioId,
} from "./constants";

/* ── Position math ─────────────────────────────────────────────────────── */

export function healthFactor(collBtc: number, price: number, debt: number): number {
  if (debt <= 0.005) return Infinity;
  return (collBtc * price * LIQ_THRESHOLD) / debt;
}

/** BTC price at which HF hits `hf` for this position. */
export function priceAtHf(collBtc: number, debt: number, hf: number): number {
  if (collBtc <= 0) return 0;
  return (debt * hf) / (collBtc * LIQ_THRESHOLD);
}

export const liquidationPrice = (collBtc: number, debt: number) => priceAtHf(collBtc, debt, 1);
export const triggerPrice = (collBtc: number, debt: number) => priceAtHf(collBtc, debt, TRIGGER_HF);

/* ── Seeded RNG ────────────────────────────────────────────────────────── */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
}

/* ── Fixed vs variable rate ────────────────────────────────────────────── */

export interface RatePoint {
  day: number;
  variable: number;      // APR
  fixed: number;         // APR
  cumVariable: number;   // USD interest paid so far
  cumFixed: number;      // USD interest paid so far
}

/**
 * A variable borrow rate that mean-reverts around the lender rate but spikes
 * when pool utilization jumps — the thing a fixed rate protects you from.
 */
export function rateComparison(principal: number, termDays: number, fixedRate: number, seed = 11): RatePoint[] {
  const rng = mulberry32(seed);
  const steps = 48;
  const dt = termDays / steps;
  const spikeAt = Math.floor(steps * 0.55);
  let rate = 0.085;
  let cumV = 0;
  let cumF = 0;
  const out: RatePoint[] = [{ day: 0, variable: rate, fixed: fixedRate, cumVariable: 0, cumFixed: 0 }];
  for (let i = 1; i <= steps; i++) {
    rate += 0.18 * (0.105 - rate) + gaussian(rng) * 0.006;
    if (i === spikeAt) rate += 0.11; // utilization squeeze
    rate = Math.min(0.32, Math.max(0.04, rate));
    cumV += principal * rate * (dt / 365);
    cumF += principal * fixedRate * (dt / 365);
    out.push({ day: Math.round(i * dt), variable: rate, fixed: fixedRate, cumVariable: cumV, cumFixed: cumF });
  }
  return out;
}

/* ── Time machine: debt with vs without the yield sweep ───────────────── */

export interface MonthPoint {
  month: number;
  debtWith: number;
  debtWithout: number;
  yieldCum: number;      // USD yield produced by locked BTC
  sweptCum: number;      // USD of that yield sent to debt
  reserve: number;       // USD of that yield held for Tahansoe
  interestCum: number;   // USD interest charged (with-yield track)
  userPaidCum: number;   // USD the borrower paid themselves (with-yield track)
  lenderCum: number;     // USD earned by the lender at 10%
  spreadCum: number;     // USD protocol spread → rate buffer
}

export interface ProjectionInput {
  debt: number;
  collBtc: number;
  price: number;
  rate: number;
  apy: number;
  monthlyPayment: number;
  months: number;
}

export function projectMonths(p: ProjectionInput): MonthPoint[] {
  let dW = p.debt;
  let dWo = p.debt;
  let yieldCum = 0;
  let sweptCum = 0;
  let reserve = 0;
  let interestCum = 0;
  let userPaidCum = 0;
  let lenderCum = 0;
  let spreadCum = 0;
  const out: MonthPoint[] = [
    { month: 0, debtWith: dW, debtWithout: dWo, yieldCum, sweptCum, reserve, interestCum, userPaidCum, lenderCum, spreadCum },
  ];
  const monthlyYield = (p.collBtc * p.price * p.apy) / 12;

  for (let m = 1; m <= p.months; m++) {
    // Without yield: only the borrower's own payments.
    if (dWo > 0) {
      dWo += (dWo * p.rate) / 12;
      dWo = Math.max(0, dWo - p.monthlyPayment);
    }

    // With yield: borrower payment + 80% of collateral yield.
    // Collateral keeps earning after payoff, but then everything goes to the reserve.
    yieldCum += monthlyYield;
    if (dW > 0) {
      const interest = (dW * p.rate) / 12;
      interestCum += interest;
      lenderCum += (dW * LENDER_APY) / 12;
      spreadCum += (dW * PROTOCOL_SPREAD) / 12;
      dW += interest;
      const pay = Math.min(p.monthlyPayment, dW);
      dW -= pay;
      userPaidCum += pay;
      const sweep = Math.min(monthlyYield * SWEEP_TO_DEBT, dW);
      dW -= sweep;
      sweptCum += sweep;
      reserve += monthlyYield - sweep;
    } else {
      reserve += monthlyYield;
    }
    if (dW < 0.01) dW = 0;
    out.push({ month: m, debtWith: dW, debtWithout: dWo, yieldCum, sweptCum, reserve, interestCum, userPaidCum, lenderCum, spreadCum });
  }
  return out;
}

/** First month the debt is fully repaid, or null within the horizon. */
export function payoffMonth(series: MonthPoint[], key: "debtWith" | "debtWithout"): number | null {
  const hit = series.find((pt) => pt.month > 0 && pt[key] <= 0);
  return hit ? hit.month : null;
}

/* ── Tahansoe guard ───────────────────────────────────────────────────── */

/** Same shape as the Intent object in prd.md §6.2 (numbers instead of bigint). */
export interface Intent {
  action: "REPAY" | "SUPPLY_COLLATERAL" | "DELEVERAGE" | "NOOP";
  amount: number;
  asset: "USDT" | "BTC";
  source: "HOT_RESERVE" | "WARM_RESERVE" | "FLASH_LOAN";
  targetHealthFactor: number;
  reason: string;
  estimatedGas: number;
  estimatedSlippageBps: number;
}

export interface GuardTick {
  i: number;
  day: number;
  price: number;
  hfWith: number;
  hfWithout: number;
  debtWith: number;
  collWith: number;
  reserve: number;
}

export interface GuardEvent {
  tick: number;
  lane: "with" | "without";
  kind: "warn" | "intent" | "liquidation";
  text: string;
  intent?: Intent;
}

export interface GuardSummary {
  scenario: ScenarioId;
  finalPrice: number;
  actions: number;
  repaidFromReserve: number;
  repaidViaFlash: number;
  btcSoldWith: number;
  costWith: number;           // flash fee + slippage
  minHfWith: number;
  finalHfWith: number;
  liquidations: number;
  btcSeizedWithout: number;
  penaltyWithout: number;
  minHfWithout: number;
  finalHfWithout: number;
  endDebtWith: number;
  endCollWith: number;
  endReserve: number;
}

export interface GuardRun {
  ticks: GuardTick[];
  events: GuardEvent[];
  summary: GuardSummary;
}

const TICKS = 64;

export function scenarioTarget(scenario: ScenarioId, price0: number, collBtc: number, debt: number): { price: number; days: number } {
  switch (scenario) {
    case "dip":
      return { price: price0 * 0.75, days: 3 };
    case "bear":
      return { price: price0 * 0.45, days: 60 };
    case "crash":
      return { price: Math.min(price0 * 0.9, liquidationPrice(collBtc, debt) * 0.9), days: 2 };
  }
}

export function pricePath(scenario: ScenarioId, price0: number, target: number, seed = 5): number[] {
  const rng = mulberry32(seed + scenario.length * 101);
  const path: number[] = [];
  for (let i = 0; i <= TICKS; i++) {
    const t = i / TICKS;
    // smoothstep for crashes, linear bleed for bears, fast-then-flat for dips
    const shape = scenario === "crash" ? t * t * (3 - 2 * t) : scenario === "bear" ? t : 1 - (1 - t) ** 2;
    const base = price0 + (target - price0) * Math.min(1, shape);
    const wobble = Math.sin(Math.PI * t) * gaussian(rng) * price0 * 0.012;
    path.push(i === TICKS ? target : Math.max(target * 0.98, base + wobble));
  }
  return path;
}

export function runGuard(input: {
  scenario: ScenarioId;
  collBtc: number;
  price0: number;
  debt: number;
  reserve: number;
}): GuardRun {
  const { scenario, price0 } = input;
  const target = scenarioTarget(scenario, price0, input.collBtc, input.debt);
  const path = pricePath(scenario, price0, target.price);

  // with Tahansoe
  let collW = input.collBtc;
  let debtW = input.debt;
  let reserve = input.reserve;
  // without Tahansoe
  let collWo = input.collBtc;
  let debtWo = input.debt;

  const ticks: GuardTick[] = [];
  const events: GuardEvent[] = [];
  const s = {
    actions: 0,
    repaidFromReserve: 0,
    repaidViaFlash: 0,
    btcSoldWith: 0,
    costWith: 0,
    liquidations: 0,
    btcSeizedWithout: 0,
    penaltyWithout: 0,
    minHfWith: Infinity,
    minHfWithout: Infinity,
  };
  let warned = false;
  const sellCost = (1 + FLASH_LOAN_FEE) / (1 - SWAP_SLIPPAGE); // USD of collateral sold per USD repaid

  path.forEach((price, i) => {
    const day = +(target.days * (i / TICKS)).toFixed(2);

    /* lane: with Tahansoe */
    let hfW = healthFactor(collW, price, debtW);
    s.minHfWith = Math.min(s.minHfWith, hfW); // lowest HF seen, before Tahansoe reacts on this tick
    if (!warned && hfW < TRIGGER_HF + 0.25 && hfW >= TRIGGER_HF) {
      warned = true;
      events.push({ tick: i, lane: "with", kind: "warn", text: `HF ${fmtHf(hfW)} — approaching trigger ${TRIGGER_HF.toFixed(2)}. Watching every oracle update.` });
    }
    if (hfW < TRIGGER_HF) {
      const neededRepay = debtW - (collW * price * LIQ_THRESHOLD) / TARGET_HF;
      const fromReserve = Math.min(reserve, neededRepay);
      if (fromReserve > 1) {
        debtW -= fromReserve;
        reserve -= fromReserve;
        s.repaidFromReserve += fromReserve;
        s.actions++;
        events.push({
          tick: i,
          lane: "with",
          kind: "intent",
          text: `Repaid ${fmtUsd(fromReserve)} from the yield-funded reserve.`,
          intent: {
            action: "REPAY",
            amount: round2(fromReserve),
            asset: "USDT",
            source: "HOT_RESERVE",
            targetHealthFactor: TARGET_HF,
            reason: `HF ${hfW.toFixed(3)} < trigger ${TRIGGER_HF.toFixed(2)}; reserve built from collateral yield`,
            estimatedGas: 182_000,
            estimatedSlippageBps: 0,
          },
        });
        hfW = healthFactor(collW, price, debtW);
      }
      if (hfW < TARGET_HF - 0.005) {
        // Flash-loan deleverage: borrow USDT, repay, withdraw BTC, swap, close flash loan.
        const repay = (collW * price * LIQ_THRESHOLD - TARGET_HF * debtW) / (LIQ_THRESHOLD * sellCost - TARGET_HF);
        const btcSold = (repay * sellCost) / price;
        debtW -= repay;
        collW -= btcSold;
        s.repaidViaFlash += repay;
        s.btcSoldWith += btcSold;
        s.costWith += repay * (sellCost - 1);
        s.actions++;
        events.push({
          tick: i,
          lane: "with",
          kind: "intent",
          text: `Flash-loan deleverage: repaid ${fmtUsd(repay)}, sold ${fmtBtc(btcSold)} collateral.`,
          intent: {
            action: "DELEVERAGE",
            amount: round2(repay),
            asset: "USDT",
            source: "FLASH_LOAN",
            targetHealthFactor: TARGET_HF,
            reason: fromReserve > 1 ? "Reserve exhausted; flash loan covers the rest" : `HF ${hfW.toFixed(3)} < trigger ${TRIGGER_HF.toFixed(2)}; no reserve available`,
            estimatedGas: 318_000,
            estimatedSlippageBps: Math.round(SWAP_SLIPPAGE * 10_000),
          },
        });
        hfW = healthFactor(collW, price, debtW);
      }
    }

    /* lane: without Tahansoe */
    let hfWo = healthFactor(collWo, price, debtWo);
    s.minHfWithout = Math.min(s.minHfWithout, hfWo); // before the liquidator hits
    if (hfWo < 1 && collWo > 0) {
      const repay = debtWo * CLOSE_FACTOR;
      const seized = Math.min(collWo, (repay * (1 + LIQ_PENALTY)) / price);
      debtWo -= repay;
      collWo -= seized;
      s.liquidations++;
      s.btcSeizedWithout += seized;
      s.penaltyWithout += repay * LIQ_PENALTY;
      events.push({
        tick: i,
        lane: "without",
        kind: "liquidation",
        text: `Liquidated: ${fmtUsd(repay)} debt closed, ${fmtBtc(seized)} seized incl. ${(LIQ_PENALTY * 100).toFixed(1)}% penalty.`,
      });
      hfWo = healthFactor(collWo, price, debtWo);
    }

    ticks.push({ i, day, price, hfWith: hfW, hfWithout: hfWo, debtWith: debtW, collWith: collW, reserve });
  });

  const last = ticks[ticks.length - 1];
  return {
    ticks,
    events,
    summary: {
      scenario,
      finalPrice: last.price,
      ...s,
      finalHfWith: last.hfWith,
      finalHfWithout: last.hfWithout,
      endDebtWith: debtW,
      endCollWith: collW,
      endReserve: reserve,
    },
  };
}

/* ── Formatting ───────────────────────────────────────────────────────── */

const round2 = (n: number) => Math.round(n * 100) / 100;

export function fmtUsd(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtBtc(n: number): string {
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} BTC`;
}

export function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtHf(hf: number): string {
  if (!Number.isFinite(hf)) return "∞";
  return hf >= 100 ? "99+" : hf.toFixed(2);
}

export function hfTone(hf: number): "safe" | "warning" | "danger" {
  if (hf < 1.1) return "danger";
  if (hf < TRIGGER_HF + 0.25) return "warning";
  return "safe";
}

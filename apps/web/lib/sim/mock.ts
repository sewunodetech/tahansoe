/**
 * Canned simnet responses for SIMNET_MOCK=1, so the Simulation Mode UI can be built and demoed
 * without apps/simnet. State is in-memory per server process; prices follow simple scripted
 * paths and a crash past the trigger produces a fake L1 → L3 protection.
 */

import { ARBITRUM_ONE } from "@tahansoe/domain";
import type { Address } from "viem";
import type { SimEvent, SimHealth, SimMode, SimnetSession, SimScenarioId, SimStatus } from "./types";

const START_PRICE = 3_000;
const CRASH_RAMP_MS = 20_000;
const REPLAY_MS = 180_000;
const PRIVATE_TTL_MS = 15 * 60_000;

/** Fraction of the start price at each step of a replay, roughly shaped after the real event. */
const REPLAY_PATHS: Record<SimScenarioId, number[]> = {
  "aug-2024-yen-carry": [1, 0.98, 0.95, 0.9, 0.84, 0.78, 0.8, 0.83, 0.85],
  "oct-2025-tariff-crash": [1, 0.99, 0.96, 0.88, 0.8, 0.82, 0.86, 0.87],
  "mar-2020-black-thursday": [1, 0.93, 0.85, 0.72, 0.6, 0.55, 0.62, 0.66],
};

interface MockSession {
  mode: SimMode;
  createdAt: number;
  crash: { pct: number; at: number } | null;
  replay: { scenario: SimScenarioId; at: number } | null;
}

const sessions = new Map<string, MockSession>();

const hex = (n: number, len: number) => `0x${n.toString(16).padStart(len, "0")}`;
const fakeAddress = (n: number) => hex(n, 40) as Address;

export function mockHealth(): SimHealth {
  const priv = [...sessions.values()].filter((s) => s.mode !== "live").length;
  return { ok: true, forks: { live: 1, private: priv, max: 4 }, mock: true };
}

export function mockCreateSession(input: { mode: SimMode; scenario?: SimScenarioId }): SimnetSession {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  sessions.set(sessionId, {
    mode: input.mode,
    createdAt: now,
    crash: null,
    replay: input.mode === "replay" && input.scenario ? { scenario: input.scenario, at: now } : null,
  });
  const forkId = input.mode === "live" ? "shared-live" : `private-${sessionId.slice(0, 6)}`;
  return {
    sessionId,
    forkId,
    rpcPath: `/rpc/${forkId}`,
    chainId: 4216199,
    contracts: {
      guardian: fakeAddress(0x9a4d1),
      simPriceFeed: fakeAddress(0x5f33d),
      testVault: fakeAddress(0x7e57),
      pool: ARBITRUM_ONE.aave!.pool!,
      weth: ARBITRUM_ONE.tokens!.WETH,
      usdc: ARBITRUM_ONE.tokens!.USDC,
    },
    expiresAt: input.mode === "live" ? null : new Date(now + PRIVATE_TTL_MS).toISOString(),
  };
}

export function mockDeleteSession(id: string): void {
  sessions.delete(id);
}

/** Sessions survive only as long as the dev server process; recreate one the cookie still names. */
function ensure(id: string, mode: SimMode): MockSession {
  let s = sessions.get(id);
  if (!s) {
    s = { mode, createdAt: Date.now(), crash: null, replay: null };
    sessions.set(id, s);
  }
  return s;
}

export function mockScenario(
  id: string,
  mode: SimMode,
  body: { kind: "replay"; scenario: SimScenarioId } | { kind: "crash"; pct: number }
): boolean {
  const s = ensure(id, mode);
  if (body.kind === "crash") s.crash = { pct: body.pct, at: Date.now() };
  else s.replay = { scenario: body.scenario, at: Date.now() };
  return true;
}

function priceAt(s: MockSession, now: number): { price: number; progress?: number } {
  const wobble = 1 + 0.002 * Math.sin(now / 7_000);
  if (s.replay) {
    const path = REPLAY_PATHS[s.replay.scenario];
    const t = Math.min(1, (now - s.replay.at) / REPLAY_MS);
    const pos = t * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(pos));
    const frac = path[i] + (path[i + 1] - path[i]) * (pos - i);
    return { price: START_PRICE * frac, progress: t };
  }
  if (s.crash) {
    const t = Math.min(1, (now - s.crash.at) / CRASH_RAMP_MS);
    return { price: START_PRICE * (1 - (s.crash.pct / 100) * t) };
  }
  return { price: START_PRICE * wobble };
}

/** Fake keeper: once the price is down more than 12%, the Guardian "protects" the sample position. */
function eventsAt(s: MockSession, price: number, now: number): SimEvent[] {
  const drop = 1 - price / START_PRICE;
  const since = s.crash?.at ?? s.replay?.at;
  if (since === undefined || drop < 0.12) return [];
  const block = 300_000_000 + Math.floor((now - s.createdAt) / 250);
  const tx = (n: number) => hex(0xabc000 + n, 64);
  const events: SimEvent[] = [
    { type: "layer", txHash: tx(1), blockNumber: block, layer: 1, amount: "1200", hfBefore: 1.38, hfAfter: 1.52 },
    { type: "protected", txHash: tx(1), blockNumber: block, hfBefore: 1.38, hfAfter: 1.72 },
    { type: "fee", txHash: tx(1), blockNumber: block, amount: "6.40", waived: false },
  ];
  if (drop >= 0.3) {
    events.push(
      { type: "layer", txHash: tx(2), blockNumber: block + 40, layer: 3, amount: "1150", hfBefore: 1.33, hfAfter: 1.7 },
      { type: "protected", txHash: tx(2), blockNumber: block + 40, hfBefore: 1.33, hfAfter: 1.7 },
      { type: "fee", txHash: tx(2), blockNumber: block + 40, amount: "5.10", waived: false }
    );
  }
  return events;
}

export function mockStatus(id: string, mode: SimMode): SimStatus {
  const s = ensure(id, mode);
  const now = Date.now();
  const { price, progress } = priceAt(s, now);
  return {
    mode: s.mode,
    price: Math.round(price * 100) / 100,
    priceSource: s.replay ? `replay:${s.replay.scenario}` : s.crash ? "stress" : "chainlink:arbitrum-one",
    scenarioProgress: progress,
    expiresAt: s.mode === "live" ? null : new Date(s.createdAt + PRIVATE_TTL_MS).toISOString(),
    events: eventsAt(s, price, now),
    keeperCheckedAt: new Date(now - 1_500).toISOString(),
  };
}

export function mockFaucet(asset: string, amount: number): { balances: Record<string, string> } {
  return { balances: { [asset]: String(amount) } };
}

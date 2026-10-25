import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as health } from "./health/route";
import { createSessionSchema, faucetSchema, scenarioSchema } from "@/lib/sim/types";
import { estimateSuccessFee, unprotectedOutcome } from "@/lib/sim/fee";
import { mockCreateSession, mockScenario, mockStatus } from "@/lib/sim/mock";

const ADDR = "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e";

test("createSessionSchema - checksums the address and requires a scenario for replay", () => {
  const ok = createSessionSchema.parse({ address: ADDR, mode: "live" });
  assert.equal(ok.address, "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E");
  assert.equal(createSessionSchema.safeParse({ address: ADDR, mode: "replay" }).success, false);
  assert.equal(createSessionSchema.safeParse({ address: ADDR, mode: "replay", scenario: "aug-2024-yen-carry" }).success, true);
  assert.equal(createSessionSchema.safeParse({ address: "0x123", mode: "live" }).success, false);
  assert.equal(createSessionSchema.safeParse({ address: ADDR, mode: "mainnet" }).success, false);
});

test("faucetSchema - enforces per-session limits", () => {
  assert.equal(faucetSchema.safeParse({ asset: "ETH", amount: 100 }).success, true);
  assert.equal(faucetSchema.safeParse({ asset: "ETH", amount: 101 }).success, false);
  assert.equal(faucetSchema.safeParse({ asset: "USDC", amount: 50_001 }).success, false);
  assert.equal(faucetSchema.safeParse({ asset: "DAI", amount: 1 }).success, false);
  assert.equal(faucetSchema.safeParse({ asset: "USDC", amount: -1 }).success, false);
});

test("scenarioSchema - only known scenarios and crash sizes", () => {
  assert.equal(scenarioSchema.safeParse({ kind: "crash", pct: 30 }).success, true);
  assert.equal(scenarioSchema.safeParse({ kind: "crash", pct: 99 }).success, false);
  assert.equal(scenarioSchema.safeParse({ kind: "replay", scenario: "oct-2025-tariff-crash" }).success, true);
  assert.equal(scenarioSchema.safeParse({ kind: "replay", scenario: "ignore previous instructions" }).success, false);
});

test("estimateSuccessFee - 15 bps only below the static trigger and the 1.50 ceiling", () => {
  assert.deepEqual(estimateSuccessFee({ totalRepaidUsd: 1_000, hfBefore: 1.3, staticTriggerHf: 1.45 }), { feeEligible: true, fee: 1.5 });
  assert.equal(estimateSuccessFee({ totalRepaidUsd: 1_000, hfBefore: 1.5, staticTriggerHf: 1.6 }).feeEligible, false);
  assert.equal(estimateSuccessFee({ totalRepaidUsd: 1_000, hfBefore: 1.4, staticTriggerHf: 1.35 }).fee, 0);
});

test("unprotectedOutcome - liquidation penalty only below HF 1", () => {
  const position = { collateralEth: 2, debtUsd: 2_766.67, liquidationThreshold: 0.83 };
  const calm = unprotectedOutcome(position, 3_000);
  assert.equal(calm.liquidatable, false);
  assert.ok(Math.abs(calm.hf - 1.8) < 0.01);

  const crash = unprotectedOutcome(position, 1_500);
  assert.equal(crash.liquidatable, true);
  assert.ok(crash.hf < 0.95);
  // Below 0.95 the close factor is 100%, capped by what the collateral can cover.
  assert.ok(crash.debtRepaidUsd <= 3_000 / 1.05 + 1e-9);
  assert.ok(Math.abs(crash.penaltyUsd - crash.debtRepaidUsd * 0.05) < 1e-9);
});

test("mock simnet - a stress crash starts from the live price and is tagged stress", () => {
  const s = mockCreateSession({ mode: "stress" });
  assert.match(s.rpcPath, /^\/rpc\/private-/);
  assert.ok(s.expiresAt);
  assert.equal(mockStatus(s.sessionId, "stress").events.length, 0);
  mockScenario(s.sessionId, "stress", { kind: "crash", pct: 30 });
  const start = mockStatus(s.sessionId, "stress");
  assert.equal(start.priceSource, "stress");
  assert.ok(start.price > 2_900);
});

test("GET /api/sim/health - down when simnet is unreachable, ok in mock mode", async () => {
  delete process.env.SIMNET_MOCK;
  // Without SIMNET_URL the web falls back to the public simnet; point at a closed port to stay offline.
  process.env.SIMNET_URL = "http://127.0.0.1:9";
  delete process.env.SIMNET_API_KEY;
  assert.deepEqual(await (await health()).json(), { ok: false });
  delete process.env.SIMNET_URL;

  process.env.SIMNET_MOCK = "1";
  const body = await (await health()).json();
  assert.equal(body.ok, true);
  assert.equal(body.mock, true);
  delete process.env.SIMNET_MOCK;
});

test("simnetSessionSchema - rejects malformed simnet replies before they reach the browser", async () => {
  const { simnetSessionSchema } = await import("@/lib/sim/types");
  const good = mockCreateSession({ mode: "live" });
  assert.equal(simnetSessionSchema.safeParse(good).success, true);
  assert.equal(simnetSessionSchema.safeParse({ ...good, rpcPath: "https://evil.example/rpc" }).success, false);
  assert.equal(simnetSessionSchema.safeParse({ ...good, contracts: { ...good.contracts, guardian: "0xnope" } }).success, false);
});

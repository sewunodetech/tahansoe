/**
 * Shapes and validation for the web ↔ simnet contract (spec m1-simulation-mode §3.5).
 * Shared by the /api/sim route handlers (server) and the dashboard (client); no secrets here.
 */

import { z } from "zod";
import { getAddress, isAddress, type Address } from "viem";

export const SIM_MODES = ["live", "replay", "stress"] as const;
export type SimMode = (typeof SIM_MODES)[number];

export const SIM_SCENARIOS = [
  { id: "aug-2024-yen-carry", label: "Aug 2024 — yen carry unwind", normalized: false },
  { id: "oct-2025-tariff-crash", label: "Oct 2025 — US–China tariff crash", normalized: false },
  { id: "mar-2020-black-thursday", label: "Mar 2020 — Black Thursday", normalized: true },
] as const;
export type SimScenarioId = (typeof SIM_SCENARIOS)[number]["id"];
const SCENARIO_IDS = SIM_SCENARIOS.map((s) => s.id) as [SimScenarioId, ...SimScenarioId[]];

export const CRASH_PCTS = [10, 30, 50] as const;

/** Faucet limits per session (spec §3.5). */
export const FAUCET_LIMITS = { ETH: 100, WETH: 100, USDC: 50_000 } as const;
export type FaucetAsset = keyof typeof FAUCET_LIMITS;

const addressSchema = z
  .string()
  .refine((v) => isAddress(v, { strict: false }), "Invalid address")
  .transform((v) => getAddress(v));

export const createSessionSchema = z
  .object({
    address: addressSchema,
    mode: z.enum(SIM_MODES),
    scenario: z.enum(SCENARIO_IDS).optional(),
  })
  .refine((v) => v.mode !== "replay" || v.scenario !== undefined, { message: "Replay needs a scenario", path: ["scenario"] });

export const sessionEventSchema = z.object({
  event: z.enum(["position_opened", "converted"]),
});

export const faucetSchema = z
  .object({
    asset: z.enum(["ETH", "WETH", "USDC"]),
    amount: z.number().positive(),
  })
  .refine((v) => v.amount <= FAUCET_LIMITS[v.asset], { message: "Amount exceeds the per-session limit", path: ["amount"] });

export const scenarioSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replay"), scenario: z.enum(SCENARIO_IDS) }),
  z.object({ kind: z.literal("crash"), pct: z.union([z.literal(10), z.literal(30), z.literal(50)]) }),
]);

/** Shape check on simnet's POST /v1/sessions reply before it reaches the cookie and the browser. */
export const simnetSessionSchema = z.object({
  sessionId: z.string().min(1).max(128),
  forkId: z.string().regex(/^[\w-]{1,64}$/),
  rpcPath: z.string().regex(/^\/[\w\-/]{1,128}$/),
  chainId: z.number().int(),
  contracts: z.object({
    guardian: addressSchema,
    simPriceFeed: addressSchema,
    testVault: addressSchema.optional(),
    pool: addressSchema,
    weth: addressSchema,
    usdc: addressSchema,
  }),
  expiresAt: z.string().nullable(),
});

export interface SimContracts {
  guardian: Address;
  simPriceFeed: Address;
  testVault?: Address;
  pool: Address;
  weth: Address;
  usdc: Address;
}

/** POST /v1/sessions response. */
export interface SimnetSession {
  sessionId: string;
  forkId: string;
  rpcPath: string;
  chainId: number;
  contracts: SimContracts;
  expiresAt: string | null;
}

export interface SimEvent {
  type: "protected" | "layer" | "fee";
  txHash: string;
  blockNumber: number;
  layer?: number;
  amount?: string | number;
  hfBefore?: number;
  hfAfter?: number;
  waived?: boolean;
}

/** GET /v1/sessions/:id/status response. */
export interface SimStatus {
  mode: SimMode;
  price: number;
  priceSource: string;
  scenarioProgress?: number;
  expiresAt: string | null;
  events: SimEvent[];
}

export interface SimHealth {
  ok: boolean;
  forks?: { live: number; private: number; max: number };
  mock?: boolean;
}

/** What the web keeps in the iron-session cookie and returns from GET /api/sim/session. */
export interface SimSessionInfo {
  sessionId: string;
  address: Address;
  forkId: string;
  mode: SimMode;
  scenario?: SimScenarioId;
  expiresAt: string | null;
  rpcPath: string;
  contracts: SimContracts;
  mock?: boolean;
}

/**
 * Kontrak bersama Protection Strategy Agent (spec m4-protection-strategy-agent, ADR 0016).
 *
 * Modul murni tanpa I/O: schema `ProtectionPlan`, mandat, playbook, dan tipe `ProtectionDecider`
 * yang dipakai engine (agent, rule engine) dan backtest. Deskripsi schema dalam bahasa Inggris
 * karena ikut dikirim ke LLM (AGENTS.md).
 */

import { z } from "zod";
import type { Regime } from "../types";

/** Aksi proteksi. Urutan = eskalasi. */
export const PROTECTION_ACTIONS = [
  "HOLD",
  "SHIFT_TRIGGER",
  "REPAY_WALLET",
  "REPAY_VAULT",
  "DELEVERAGE",
] as const;
export type ProtectionAction = (typeof PROTECTION_ACTIONS)[number];

/** Bit mask aksi di mandat (Guardian v5). `HOLD` selalu diizinkan dan tidak punya bit. */
export const MANDATE_ACTION_BITS: Record<Exclude<ProtectionAction, "HOLD">, number> = {
  SHIFT_TRIGGER: 1 << 0,
  REPAY_WALLET: 1 << 1,
  REPAY_VAULT: 1 << 2,
  DELEVERAGE: 1 << 3,
};

const bigintString = z
  .string()
  .regex(/^\d+$/, "unsigned integer in token base units, as a decimal string");

export const ProtectionPlanSchema = z.object({
  positionKey: z.string().min(1).describe("Canonical position key, e.g. aave-v3:<chainId>:<guardian>:<debtAsset>"),
  strategyVersion: z.string().min(1).describe("Version of the strategy library that produced this plan"),
  action: z.enum(PROTECTION_ACTIONS).describe("Protection action to take now"),
  amount: bigintString.optional().describe("Debt-token base units to repay; required for REPAY_* and DELEVERAGE"),
  triggerHf: z.number().positive().optional().describe("New trigger health factor; required for SHIFT_TRIGGER"),
  expectedHfAfter: z.number().positive().describe("Expected health factor after the action"),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
  drivers: z.array(z.string()).max(20).describe("IDs of signals or assessments used; never free text from sources"),
  playbookIds: z.array(z.string()).max(10),
  validUntil: z.string().datetime().describe("ISO timestamp after which the plan must be ignored"),
});
export type ProtectionPlan = z.infer<typeof ProtectionPlanSchema>;

/** Mandat user untuk agent per posisi (ADR 0016 §1). Fase A: dipakai sebagai batas virtual. */
export interface Mandate {
  positionKey: string;
  agent: string;
  /** ERC-8004 agentId (ADR 0017). */
  agentId?: bigint;
  actionMask: number;
  /** Cap per aksi, unit dasar token utang. */
  maxPerAction: bigint;
  /** Cap bergulir 24 jam, unit dasar token utang. */
  maxPer24h: bigint;
  /** Di atas HF ini agent tidak boleh bertindak. */
  maxPreemptHF: number;
  validUntil: Date;
}

/** Default mandat (keputusan owner 25 Okt 2026, spec §7). */
export function defaultMandate(params: {
  positionKey: string;
  agent: string;
  staticTriggerHf: number;
  maxRepayPerAction: bigint;
  validUntil: Date;
  agentId?: bigint;
}): Mandate {
  return {
    positionKey: params.positionKey,
    agent: params.agent,
    agentId: params.agentId,
    // DELEVERAGE mati secara default (ADR 0016 §1).
    actionMask: MANDATE_ACTION_BITS.SHIFT_TRIGGER | MANDATE_ACTION_BITS.REPAY_WALLET | MANDATE_ACTION_BITS.REPAY_VAULT,
    maxPerAction: params.maxRepayPerAction,
    maxPer24h: params.maxRepayPerAction * 3n,
    maxPreemptHF: params.staticTriggerHf + 0.25,
    validUntil: params.validUntil,
  };
}

export function mandateAllows(mandate: Mandate, action: ProtectionAction): boolean {
  if (action === "HOLD") return true;
  return (mandate.actionMask & MANDATE_ACTION_BITS[action]) !== 0;
}

/** Keadaan satu posisi yang dilihat decider pada satu tick (live atau backtest). */
export interface PositionState {
  positionKey: string;
  at: Date;
  healthFactor: number;
  collateralUsd: number;
  debtUsd: number;
  /** Liquidation threshold tertimbang, desimal (0.825 = 82.5%). */
  liquidationThreshold: number;
  debtAsset: { address: string; symbol: string; decimals: number; priceUsd: number };
  /** Cadangan yang bisa dipakai, unit dasar token utang. */
  reserves: { wallet: bigint; vault: bigint };
  policy: { triggerHf: number; targetHf: number; maxRepayPerAction: bigint };
  /** Regime aset kolateral utama dari Core Risk Engine; null bila tidak ada atau basi. */
  regime: Regime | null;
  /** ID assessment/sinyal yang tersedia, untuk `drivers`. */
  signalIds: string[];
  /** Jumlah yang sudah dipakai agent dalam 24 jam terakhir, unit dasar token utang. */
  spent24h: bigint;
}

/** Fungsi keputusan: statis, dynamic trigger, atau Protection Agent. Dipakai live dan backtest. */
export type ProtectionDecider = (state: PositionState, mandate: Mandate) => ProtectionPlan | Promise<ProtectionPlan>;

/** Playbook proteksi yang bisa diuji (spec §3.4). Data, bukan instruksi (ADR 0005). */
export interface Playbook {
  id: string;
  description: string;
  /** Kondisi masuk. Semua yang diisi harus terpenuhi. */
  when: {
    regimeAtLeast?: Regime;
    hfBelow?: number;
    hfAbove?: number;
  };
  action: Exclude<ProtectionAction, "HOLD">;
  /** HF target aksi; untuk SHIFT_TRIGGER = trigger baru. */
  targetHf: number;
  /** Asal playbook: survivor miner, settlement, atau manual. */
  source: "MINER" | "SETTLEMENT" | "MANUAL";
  /** Ringkasan bukti agregat (tanpa daftar wallet untuk diikuti). */
  evidence?: { sampleSize: number; survivalRate?: number; windowIds?: string[] };
}

export interface StrategyVersion {
  version: string;
  playbooks: Playbook[];
  status: "CANDIDATE" | "ACTIVE" | "RETIRED";
}

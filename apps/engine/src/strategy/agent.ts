/**
 * Protection Strategy Agent Decider (spec m4-protection-strategy-agent §3.2, ADR 0002, ADR 0016).
 *
 * Inti deterministik:
 *  1. Cocokkan playbook dari StrategyVersion aktif terhadap PositionState (regime, HF).
 *  2. Pilih aksi dengan tingkat eskalasi terendah yang mampu mencapai target HF playbook
 *     berdasarkan mandat dan cadangan yang tersedia.
 *  3. Hitung jumlah pelunasan (amount) secara deterministik menggunakan matematika Aave
 *     (repayToTargetBase) dengan pembatasan cap per aksi, sisa cap 24 jam, dan cadangan.
 *  4. Komponen LLM bersifat opsional dan hanya boleh memilih/memberi peringkat serta
 *     menjelaskan di antara rencana kandidat yang sudah terbukti valid.
 *  5. Jika LLM gagal, crash, melempar error, atau menghasilkan schema tidak valid, sistem
 *     selalu jatuh kembali (fallback) ke pilihan deterministik (invarian I6).
 */

import {
  baseToToken,
  hfToWad,
  repayToTargetBase,
  ProtectionPlanSchema,
  mandateAllows,
  type Mandate,
  type Playbook,
  type PositionState,
  type ProtectionAction,
  type ProtectionPlan,
  type ProtectionDecider,
  type StrategyVersion,
  REGIMES,
} from "@tahansoe/domain";
import { type StrategyLibrary } from "./library.ts";
import { validateProtectionPlan } from "./validate.ts";

/**
 * Tingkat eskalasi aksi proteksi (0 = paling rendah / aman, 4 = paling agresif).
 */
export const ACTION_ESCALATION_LEVEL: Record<ProtectionAction, number> = {
  HOLD: 0,
  SHIFT_TRIGGER: 1,
  REPAY_WALLET: 2,
  REPAY_VAULT: 3,
  DELEVERAGE: 4,
};

export interface LlmRankerContext {
  state: PositionState;
  mandate: Mandate;
  candidatePlans: ProtectionPlan[];
}

export type LlmRanker = (
  context: LlmRankerContext,
) => Promise<ProtectionPlan | null | undefined> | ProtectionPlan | null | undefined;

export interface ProtectionAgentDeciderOptions {
  /** LLM opsional untuk memilih/merangking kandidat yang sudah valid */
  llm?: LlmRanker;
  /** Masa berlaku plan dalam menit (default 15 menit) */
  validityMinutes?: number;
}

interface CandidateEvaluation {
  plan: ProtectionPlan;
  playbook: Playbook;
  reachesTarget: boolean;
  escalation: number;
}

/**
 * Memeriksa apakah playbook cocok dengan PositionState.
 */
function matchesPlaybook(playbook: Playbook, state: PositionState): boolean {
  const { when } = playbook;

  // Cek regimeAtLeast
  if (when.regimeAtLeast) {
    if (!state.regime) return false;
    const currentIdx = REGIMES.indexOf(state.regime);
    const requiredIdx = REGIMES.indexOf(when.regimeAtLeast);
    if (currentIdx < requiredIdx) return false;
  }

  // Cek hfBelow
  if (when.hfBelow !== undefined) {
    if (state.healthFactor >= when.hfBelow) return false;
  }

  // Cek hfAbove
  if (when.hfAbove !== undefined) {
    if (state.healthFactor <= when.hfAbove) return false;
  }

  return true;
}

/**
 * Hitung amount pelunasan deterministik dan expected HF setelah aksi.
 */
function computeRepayAmountAndExpectedHf(
  state: PositionState,
  targetHf: number,
  mandate: Mandate,
  action: Exclude<ProtectionAction, "HOLD" | "SHIFT_TRIGGER">,
): { amount: bigint; expectedHfAfter: number } | null {
  const collateralBase = BigInt(Math.round(state.collateralUsd * 1e8));
  const debtBase = BigInt(Math.round(state.debtUsd * 1e8));
  const liquidationThresholdBps = BigInt(Math.round(state.liquidationThreshold * 10_000));
  const targetHfWad = hfToWad(targetHf);

  const requiredDebtBase = repayToTargetBase(
    { collateralBase, debtBase, liquidationThresholdBps },
    targetHfWad,
  );

  if (requiredDebtBase <= 0n) {
    return null;
  }

  const priceBase = BigInt(Math.round(state.debtAsset.priceUsd * 1e8));
  const requiredTokenUnits = baseToToken(requiredDebtBase, priceBase, state.debtAsset.decimals);
  const totalDebtTokenUnits = baseToToken(debtBase, priceBase, state.debtAsset.decimals);

  // Hitung batas maksimum pelunasan (caps & reserves)
  const remaining24h = mandate.maxPer24h > state.spent24h ? mandate.maxPer24h - state.spent24h : 0n;
  let maxAllowed = mandate.maxPerAction;
  if (maxAllowed > remaining24h) maxAllowed = remaining24h;
  if (maxAllowed > totalDebtTokenUnits) maxAllowed = totalDebtTokenUnits;

  if (action === "REPAY_WALLET") {
    if (maxAllowed > state.reserves.wallet) maxAllowed = state.reserves.wallet;
  } else if (action === "REPAY_VAULT") {
    if (maxAllowed > state.reserves.vault) maxAllowed = state.reserves.vault;
  }

  if (maxAllowed <= 0n) {
    return null;
  }

  let finalAmount = requiredTokenUnits;
  if (finalAmount > maxAllowed) {
    finalAmount = maxAllowed;
  }

  if (finalAmount <= 0n) {
    return null;
  }

  // Hitung expectedHfAfter setelah pelunasan finalAmount
  const debtRepaidBase = (finalAmount * priceBase) / (10n ** BigInt(state.debtAsset.decimals));
  const debtBaseAfter = debtBase > debtRepaidBase ? debtBase - debtRepaidBase : 0n;

  let expectedHf: number;
  if (debtBaseAfter === 0n) {
    expectedHf = 999.0;
  } else if (action === "DELEVERAGE") {
    // Pada deleverage, kolateral juga berkurang senilai utang yang dilunasi
    const collateralBaseAfter = collateralBase > debtRepaidBase ? collateralBase - debtRepaidBase : 0n;
    expectedHf =
      Number(collateralBaseAfter * liquidationThresholdBps) /
      (Number(debtBaseAfter) * 10_000);
  } else {
    expectedHf =
      Number(collateralBase * liquidationThresholdBps) /
      (Number(debtBaseAfter) * 10_000);
  }

  const roundedHf = Math.round(expectedHf * 10_000) / 10_000;
  return {
    amount: finalAmount,
    expectedHfAfter: roundedHf,
  };
}

/**
 * Tentukan tingkat urgensi berdasarkan HF posisi saat ini.
 */
function determineUrgency(hf: number): "LOW" | "MEDIUM" | "HIGH" {
  if (hf < 1.15) return "HIGH";
  if (hf < 1.3) return "MEDIUM";
  return "LOW";
}

/**
 * Factory untuk membuat ProtectionAgentDecider.
 */
export function createProtectionAgentDecider(
  library: StrategyLibrary | StrategyVersion,
  opts?: ProtectionAgentDeciderOptions,
): ProtectionDecider {
  const validityMinutes = opts?.validityMinutes ?? 15;

  return async (state: PositionState, mandate: Mandate): Promise<ProtectionPlan> => {
    const version: StrategyVersion =
      typeof (library as StrategyLibrary).getActiveVersion === "function"
        ? await (library as StrategyLibrary).getActiveVersion()
        : (library as StrategyVersion);

    const validUntilIso = new Date(
      state.at.getTime() + validityMinutes * 60_000,
    ).toISOString();

    const makeHoldPlan = (): ProtectionPlan => ({
      positionKey: state.positionKey,
      strategyVersion: version.version,
      action: "HOLD",
      expectedHfAfter: state.healthFactor,
      urgency: "LOW",
      drivers: state.signalIds.slice(0, 5),
      playbookIds: [],
      validUntil: validUntilIso,
    });

    // Batasan Mandat: bila HF saat ini > maxPreemptHF, agent tidak boleh bertindak
    if (state.healthFactor > mandate.maxPreemptHF) {
      return makeHoldPlan();
    }

    // Cari kandidat playbook yang cocok
    const candidateEvaluations: CandidateEvaluation[] = [];

    for (const pb of version.playbooks) {
      if (!matchesPlaybook(pb, state)) {
        continue;
      }

      // Cek apakah aksi diizinkan mandat
      if (!mandateAllows(mandate, pb.action)) {
        continue;
      }

      // Cek aturan CALM: hanya boleh HOLD / SHIFT_TRIGGER kecuali HF < static trigger
      if (state.regime === "CALM" && pb.action !== "SHIFT_TRIGGER") {
        if (state.healthFactor >= state.policy.triggerHf) {
          continue;
        }
      }

      if (pb.action === "SHIFT_TRIGGER") {
        // SHIFT_TRIGGER: trigger baru harus > trigger saat ini dan <= targetHf
        if (pb.targetHf <= state.healthFactor) {
          continue;
        }

        const candidatePlan: ProtectionPlan = {
          positionKey: state.positionKey,
          strategyVersion: version.version,
          action: "SHIFT_TRIGGER",
          triggerHf: pb.targetHf,
          expectedHfAfter: pb.targetHf,
          urgency: determineUrgency(state.healthFactor),
          drivers: state.signalIds.slice(0, 5),
          playbookIds: [pb.id],
          validUntil: validUntilIso,
        };

        const validation = validateProtectionPlan(candidatePlan, state, mandate, {
          now: state.at,
        });

        if (validation.decision === "ACCEPTED") {
          candidateEvaluations.push({
            plan: candidatePlan,
            playbook: pb,
            reachesTarget: true,
            escalation: ACTION_ESCALATION_LEVEL.SHIFT_TRIGGER,
          });
        }
      } else {
        // REPAY_WALLET, REPAY_VAULT, DELEVERAGE
        const calc = computeRepayAmountAndExpectedHf(state, pb.targetHf, mandate, pb.action);
        if (!calc) {
          continue;
        }

        if (calc.expectedHfAfter <= state.healthFactor) {
          continue;
        }

        const candidatePlan: ProtectionPlan = {
          positionKey: state.positionKey,
          strategyVersion: version.version,
          action: pb.action,
          amount: calc.amount.toString(),
          expectedHfAfter: calc.expectedHfAfter,
          urgency: determineUrgency(state.healthFactor),
          drivers: state.signalIds.slice(0, 5),
          playbookIds: [pb.id],
          validUntil: validUntilIso,
        };

        const validation = validateProtectionPlan(candidatePlan, state, mandate, {
          now: state.at,
        });

        if (validation.decision === "ACCEPTED") {
          // Aksi dianggap mencapai target jika expected HF setidaknya pb.targetHf - 0.005
          const reachesTarget = calc.expectedHfAfter >= pb.targetHf - 0.005;
          candidateEvaluations.push({
            plan: candidatePlan,
            playbook: pb,
            reachesTarget,
            escalation: ACTION_ESCALATION_LEVEL[pb.action],
          });
        }
      }
    }

    if (candidateEvaluations.length === 0) {
      return makeHoldPlan();
    }

    // Urutkan kandidat deterministik:
    // 1. Yang mencapai target (reachesTarget = true) lebih diutamakan
    // 2. Tingkat eskalasi terendah (least-escalated: SHIFT_TRIGGER < REPAY_WALLET < REPAY_VAULT < DELEVERAGE)
    // 3. Expected HF tertinggi
    candidateEvaluations.sort((a, b) => {
      if (a.reachesTarget && !b.reachesTarget) return -1;
      if (!a.reachesTarget && b.reachesTarget) return 1;

      if (a.escalation !== b.escalation) {
        return a.escalation - b.escalation;
      }

      return b.plan.expectedHfAfter - a.plan.expectedHfAfter;
    });

    const deterministicChoice = candidateEvaluations[0]!.plan;

    // Evaluasi LLM opsional: hanya boleh memilih/merangking di antara rencana kandidat valid
    if (opts?.llm) {
      try {
        const validPlans = candidateEvaluations.map((c) => c.plan);
        const llmChosenPlan = await opts.llm({
          state,
          mandate,
          candidatePlans: validPlans,
        });

        if (llmChosenPlan) {
          const parsed = ProtectionPlanSchema.safeParse(llmChosenPlan);
          if (parsed.success) {
            // Pastikan pilihan LLM adalah salah satu kandidat valid (cocok action & playbookIds)
            const isOneOfCandidates = validPlans.some(
              (c) =>
                c.action === parsed.data.action &&
                c.expectedHfAfter === parsed.data.expectedHfAfter &&
                c.amount === parsed.data.amount,
            );

            if (isOneOfCandidates) {
              return parsed.data;
            }
          }
        }
      } catch {
        // Fallback ke pilihan deterministik saat terjadi kegagalan LLM (invarian I6)
      }
    }

    return deterministicChoice;
  };
}

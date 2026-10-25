/**
 * Rule Engine & Validator Protection Plan (spec m4-protection-strategy-agent §3.3, ADR 0002, ADR 0016).
 *
 * Memeriksa rencana proteksi (ProtectionPlan) terhadap batas mandat user, umur data/regime,
 * cap per aksi / 24 jam, batas atas HF preemptif, dan konsistensi kenaikan HF.
 *
 * Menghasilkan planHash deterministik (keccak256 dari canonical JSON).
 */

import { keccak256, stringToHex } from "viem";
import {
  ProtectionPlanSchema,
  mandateAllows,
  type Mandate,
  type PositionState,
  type ProtectionPlan,
} from "@tahansoe/domain";

export interface PlanValidationOptions {
  now?: Date;
  signalsStale?: boolean;
}

export interface PlanValidationResult {
  decision: "ACCEPTED" | "REJECTED";
  reason?: string;
  planHash: `0x${string}`;
}

/**
 * Serialisasi JSON kanonik dengan urutan key alfabetis yang konsisten.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson((obj as Record<string, unknown>)[key])}`,
  );
  return "{" + entries.join(",") + "}";
}

/**
 * Menghitung planHash kanonik sebagai keccak256 dari string JSON kanonik.
 */
export function computePlanHash(plan: ProtectionPlan): `0x${string}` {
  const json = canonicalJson(plan);
  return keccak256(stringToHex(json));
}

/**
 * Memvalidasi ProtectionPlan terhadap PositionState dan Mandate.
 *
 * Ditolak bila:
 *  1. Schema tidak valid
 *  2. Plan kedaluwarsa (validUntil <= now)
 *  3. Mandat kedaluwarsa (validUntil <= now)
 *  4. Aksi tidak ada di mandat
 *  5. amount > per-action cap
 *  6. amount > sisa 24h cap
 *  7. HF > maxPreemptHF (untuk aksi non-HOLD)
 *  8. Regime/sinyal basi atau missing (regime null atau options.signalsStale)
 *  9. Regime CALM dengan aksi selain HOLD/SHIFT_TRIGGER (kecuali HF < static trigger)
 * 10. expectedHfAfter <= current HF (untuk aksi selain HOLD)
 * 11. Kolom wajib aksi hilang (mis. amount untuk REPAY/DELEVERAGE, triggerHf untuk SHIFT_TRIGGER)
 */
export function validateProtectionPlan(
  plan: ProtectionPlan,
  state: PositionState,
  mandate: Mandate,
  options?: PlanValidationOptions,
): PlanValidationResult {
  const planHash = computePlanHash(plan);

  // 1. Validasi Schema
  const parseResult = ProtectionPlanSchema.safeParse(plan);
  if (!parseResult.success) {
    return {
      decision: "REJECTED",
      reason: `Invalid plan schema: ${parseResult.error.message}`,
      planHash,
    };
  }

  const now = options?.now ?? new Date();

  // 2. Plan kedaluwarsa
  const planExpiresAt = new Date(plan.validUntil).getTime();
  if (planExpiresAt <= now.getTime()) {
    return {
      decision: "REJECTED",
      reason: `Plan has expired (validUntil: ${plan.validUntil}, now: ${now.toISOString()})`,
      planHash,
    };
  }

  // 3. Mandat kedaluwarsa
  if (mandate.validUntil.getTime() <= now.getTime()) {
    return {
      decision: "REJECTED",
      reason: `Mandate has expired (validUntil: ${mandate.validUntil.toISOString()}, now: ${now.toISOString()})`,
      planHash,
    };
  }

  // 4. Aksi tidak diizinkan mandat
  if (!mandateAllows(mandate, plan.action)) {
    return {
      decision: "REJECTED",
      reason: `Action ${plan.action} is not permitted by mandate`,
      planHash,
    };
  }

  // 5. HF > maxPreemptHF (repay/deleverage saja; SHIFT_TRIGGER dibatasi lewat triggerHf di aturan 8)
  if (plan.action !== "HOLD" && plan.action !== "SHIFT_TRIGGER" && state.healthFactor > mandate.maxPreemptHF) {
    return {
      decision: "REJECTED",
      reason: `Current HF ${state.healthFactor} is above maxPreemptHF ${mandate.maxPreemptHF}`,
      planHash,
    };
  }

  // 6. Regime/sinyal basi
  if (options?.signalsStale === true || state.regime === null) {
    if (plan.action !== "HOLD") {
      return {
        decision: "REJECTED",
        reason: "Regime or signals are stale or missing",
        planHash,
      };
    }
  }

  // 7. Regime CALM: hanya boleh HOLD atau SHIFT_TRIGGER kecuali HF < trigger statis
  if (state.regime === "CALM" && plan.action !== "HOLD" && plan.action !== "SHIFT_TRIGGER") {
    if (state.healthFactor >= state.policy.triggerHf) {
      return {
        decision: "REJECTED",
        reason: "Action not permitted in CALM regime when HF >= static trigger",
        planHash,
      };
    }
  }

  // 8. Validasi kolom amount dan triggerHf
  if (plan.action === "SHIFT_TRIGGER") {
    if (plan.triggerHf == null || plan.triggerHf <= 0) {
      return {
        decision: "REJECTED",
        reason: "triggerHf is required for SHIFT_TRIGGER",
        planHash,
      };
    }
    if (plan.triggerHf <= state.policy.triggerHf) {
      return {
        decision: "REJECTED",
        reason: `triggerHf ${plan.triggerHf} must be above the static trigger ${state.policy.triggerHf}`,
        planHash,
      };
    }
    if (plan.triggerHf >= state.policy.targetHf) {
      return {
        decision: "REJECTED",
        reason: `triggerHf ${plan.triggerHf} must be below the policy target ${state.policy.targetHf}`,
        planHash,
      };
    }
    if (plan.triggerHf > mandate.maxPreemptHF) {
      return {
        decision: "REJECTED",
        reason: `triggerHf ${plan.triggerHf} is above maxPreemptHF ${mandate.maxPreemptHF}`,
        planHash,
      };
    }
  }

  if (plan.action.startsWith("REPAY_") || plan.action === "DELEVERAGE") {
    if (!plan.amount) {
      return {
        decision: "REJECTED",
        reason: `amount is required for ${plan.action}`,
        planHash,
      };
    }
  }

  // 9. Validasi amount terhadap cap mandat
  if (plan.amount !== undefined) {
    const amount = BigInt(plan.amount);
    if (amount > mandate.maxPerAction) {
      return {
        decision: "REJECTED",
        reason: `Amount ${amount} exceeds mandate per-action cap ${mandate.maxPerAction}`,
        planHash,
      };
    }

    const remaining24h = mandate.maxPer24h > state.spent24h ? mandate.maxPer24h - state.spent24h : 0n;
    if (amount > remaining24h) {
      return {
        decision: "REJECTED",
        reason: `Amount ${amount} exceeds remaining 24h cap ${remaining24h}`,
        planHash,
      };
    }
  }

  // 10. expectedHfAfter <= current HF (menggeser trigger tidak wajib menaikkan HF)
  if (plan.action === "HOLD" || plan.action === "SHIFT_TRIGGER") {
    if (plan.expectedHfAfter < state.healthFactor) {
      return {
        decision: "REJECTED",
        reason: `expectedHfAfter (${plan.expectedHfAfter}) cannot be lower than current HF (${state.healthFactor})`,
        planHash,
      };
    }
  } else {
    if (plan.expectedHfAfter <= state.healthFactor) {
      return {
        decision: "REJECTED",
        reason: `expectedHfAfter (${plan.expectedHfAfter}) must be greater than current HF (${state.healthFactor})`,
        planHash,
      };
    }
  }

  return {
    decision: "ACCEPTED",
    planHash,
  };
}

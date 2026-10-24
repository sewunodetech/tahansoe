/**
 * Matematika simulasi cascade untuk Guardian v1 dan v2 (docs/plans/guardian-v2-execution.md §Workstream B).
 * Murni fungsional tanpa I/O atau dependensi eksternal, beroperasi dalam angka USD.
 */

export const L2_NONE = 0;
export const L2_ERC4626 = 1;
export const L2_ATOKEN = 2;

export const SUCCESS_FEE_BPS = 15;
export const FEE_HF_CEILING = 1.5;

export interface CascadeLayer1Input {
  enabled?: boolean;
  cap?: number;
  balance?: number;
  allowance?: number;
}

export interface CascadeLayer2Input {
  enabled?: boolean;
  kind?: number; // 0 = L2_NONE, 1 = L2_ERC4626, 2 = L2_ATOKEN
  source?: string;
  cap?: number;
  balance?: number;
  allowance?: number;
}

export interface CascadeLayer3Input {
  enabled?: boolean;
  collateralAsset?: string;
  maxCollateral?: number;
  slippageBps?: number;
  flashPremiumBps?: number;
}

export interface CascadeInput {
  collateralUsd: number;
  debtUsd: number;
  liquidationThreshold?: number; // default 0.825
  collateralAssetLt?: number; // default sama dengan liquidationThreshold
  triggerHf: number;
  targetHf: number;
  staticTriggerHf?: number; // default sama dengan triggerHf
  staticTrigger?: number; // alias
  leftoverDebtUsd?: number; // sisa debt token di Guardian (Sumber A)
  leftoverDebt?: number; // alias
  leftover?: number; // alias
  version?: 1 | 2; // default 2
  l1?: CascadeLayer1Input;
  l2?: CascadeLayer2Input;
  l3?: CascadeLayer3Input;
}

export type CascadeStatus =
  | "not_at_risk"
  | "target_reached"
  | "partial"
  | "no_action";

export interface CascadeResult {
  l1Repay: number;
  l2Repay: number;
  l3Collateral: number;
  l3Repay: number;
  totalRepaid: number;
  newCollateralUsd: number;
  newDebtUsd: number;
  newHf: number;
  initialHf: number;
  targetDebtUsd: number;
  neededRepayUsd: number;
  actionsCount: number;
  status: CascadeStatus;
  feeEligible: boolean;
  fee: number;
  feeWaived: number;
}

/** Buffer 0.01% (0.0001) sama dengan TARGET_BUFFER kontrak agar pembulatan tetap di atas target. */
export const CASCADE_TARGET_BUFFER = 0.0001;

/**
 * Mensimulasikan eksekusi proteksi berjenjang (cascade):
 * - L1: wallet reserve (min dari need, cap, balance, allowance)
 * - L2: position reserve (vault shares / aToken)
 * - L3: flash deleverage (menjual collateral x dengan slippage & flash premium)
 *
 * Mode v1: hanya L1, mensimulasikan panggilan keeper berulang selama HF < trigger.
 * Mode v2: satu transaksi atomik bertingkat L1 -> L2 -> L3.
 */
export function simulateCascade(input: CascadeInput): CascadeResult {
  const version = input.version ?? 2;
  const lt = input.liquidationThreshold ?? 0.825;
  const ltA = input.collateralAssetLt ?? lt;
  const target = input.targetHf + CASCADE_TARGET_BUFFER;

  const initialCollateral = input.collateralUsd;
  const initialDebt = input.debtUsd;
  const initialHf = initialDebt <= 0 ? Infinity : (initialCollateral * lt) / initialDebt;

  // Kapasitas utang pada target HF: C * LT / target
  const targetDebtUsd = (initialCollateral * lt) / target;
  const neededRepayUsd = Math.max(0, initialDebt - targetDebtUsd);

  const staticTrigger = input.staticTriggerHf ?? input.staticTrigger ?? input.triggerHf;
  const feeEligible = initialHf < staticTrigger && initialHf < FEE_HF_CEILING;

  function calculateFee(
    totalRepaid: number,
    remWalletBal: number,
    remWalletAllow: number
  ): { fee: number; feeWaived: number } {
    if (!feeEligible || totalRepaid <= 0) {
      return { fee: 0, feeWaived: 0 };
    }
    const targetFee = Math.floor((totalRepaid * SUCCESS_FEE_BPS) / 10_000);
    const leftover = Math.max(0, input.leftoverDebtUsd ?? input.leftoverDebt ?? input.leftover ?? 0);
    const fromGuardian = Math.min(targetFee, leftover);
    const feeRemaining = targetFee - fromGuardian;
    const fromWallet = Math.min(
      feeRemaining,
      remWalletBal,
      remWalletAllow
    );
    const fee = fromGuardian + fromWallet;
    const feeWaived = targetFee - fee;
    return { fee, feeWaived };
  }

  // Jika tidak dalam risiko (HF >= trigger) atau tidak berutang, tidak ada repay
  if (initialDebt <= 0 || initialHf >= input.triggerHf || neededRepayUsd <= 0) {
    return {
      l1Repay: 0,
      l2Repay: 0,
      l3Collateral: 0,
      l3Repay: 0,
      totalRepaid: 0,
      newCollateralUsd: initialCollateral,
      newDebtUsd: initialDebt,
      newHf: initialHf,
      initialHf,
      targetDebtUsd,
      neededRepayUsd,
      actionsCount: 0,
      status: "not_at_risk",
      feeEligible,
      fee: 0,
      feeWaived: 0,
    };
  }

  if (version === 1) {
    // Mode v1: L1 saja, panggilan berulang selagi HF < trigger
    let currentDebt = initialDebt;
    let remBalance = input.l1?.balance ?? Infinity;
    let remAllowance = input.l1?.allowance ?? Infinity;
    const l1Cap = input.l1?.cap ?? Infinity;
    const l1Enabled = input.l1?.enabled ?? true;

    let totalL1 = 0;
    let actionsCount = 0;

    if (l1Enabled) {
      while (true) {
        const currentHf = currentDebt <= 0 ? Infinity : (initialCollateral * lt) / currentDebt;
        if (currentHf >= input.triggerHf) break;

        const currentNeeded = Math.max(0, currentDebt - (initialCollateral * lt) / target);
        if (currentNeeded <= 0) break;

        const repay = Math.min(currentNeeded, l1Cap, remBalance, remAllowance);
        if (repay <= 0) break;

        totalL1 += repay;
        currentDebt -= repay;
        remBalance -= repay;
        remAllowance -= repay;
        actionsCount++;

        const afterHf = currentDebt <= 0 ? Infinity : (initialCollateral * lt) / currentDebt;
        if (afterHf >= target || afterHf >= input.triggerHf) break;
      }
    }

    const newHf = currentDebt <= 0 ? Infinity : (initialCollateral * lt) / currentDebt;
    const status: CascadeStatus =
      totalL1 === 0 ? "no_action" : newHf >= input.targetHf ? "target_reached" : "partial";

    const feeInfo = calculateFee(
      totalL1,
      remBalance === Infinity ? Infinity : Math.max(0, remBalance),
      remAllowance === Infinity ? Infinity : Math.max(0, remAllowance)
    );

    return {
      l1Repay: totalL1,
      l2Repay: 0,
      l3Collateral: 0,
      l3Repay: 0,
      totalRepaid: totalL1,
      newCollateralUsd: initialCollateral,
      newDebtUsd: currentDebt,
      newHf,
      initialHf,
      targetDebtUsd,
      neededRepayUsd,
      actionsCount,
      status,
      feeEligible,
      fee: feeInfo.fee,
      feeWaived: feeInfo.feeWaived,
    };
  }

  // Mode v2: cascade L1 -> L2 -> L3 dalam 1 eksekusi
  let currentDebt = initialDebt;
  let currentCollateral = initialCollateral;
  let remainingNeed = neededRepayUsd;

  // 1. Layer 1 (Wallet reserve)
  let l1Repay = 0;
  const l1Bal = input.l1?.balance ?? Infinity;
  const l1Allow = input.l1?.allowance ?? Infinity;
  const l1Enabled = input.l1?.enabled ?? true;
  if (l1Enabled && remainingNeed > 0) {
    const l1Cap = input.l1?.cap ?? Infinity;
    l1Repay = Math.max(0, Math.min(remainingNeed, l1Cap, l1Bal, l1Allow));
    currentDebt -= l1Repay;
    remainingNeed -= l1Repay;
  }

  // 2. Layer 2 (Position reserve: vault / aToken)
  let l2Repay = 0;
  const l2Enabled = input.l2?.enabled ?? (input.l2?.cap !== undefined);
  if (l2Enabled && remainingNeed > 0) {
    const l2Cap = input.l2?.cap ?? Infinity;
    const l2Bal = input.l2?.balance ?? Infinity;
    const l2Allow = input.l2?.allowance ?? Infinity;
    l2Repay = Math.max(0, Math.min(remainingNeed, l2Cap, l2Bal, l2Allow));
    currentDebt -= l2Repay;
    remainingNeed -= l2Repay;
  }

  // 3. Layer 3 (Flash Deleverage)
  let l3Collateral = 0;
  let l3Repay = 0;
  const l3Enabled = input.l3?.enabled ?? (input.l3?.maxCollateral !== undefined);
  if (l3Enabled && remainingNeed > 0 && currentDebt > 0) {
    const slippageBps = input.l3?.slippageBps ?? 50;
    const flashPremiumBps = input.l3?.flashPremiumBps ?? 5; // 0.05%
    const slippage = slippageBps / 10_000;
    const flashPremium = flashPremiumBps / 10_000;
    const k = (1 - slippage) / (1 + flashPremium);

    // Rumus: x = (T * D - C * LTavg) / (T * k - LTa)
    const numerator = target * currentDebt - currentCollateral * lt;
    const denominator = target * k - ltA;

    if (denominator > 0 && numerator > 0) {
      let x = numerator / denominator;
      const maxCollatCap = input.l3?.maxCollateral ?? Infinity;
      x = Math.min(x, maxCollatCap, currentCollateral, currentDebt / k);
      x = Math.max(0, x);

      l3Collateral = x;
      l3Repay = x * k;
      currentCollateral -= l3Collateral;
      currentDebt -= l3Repay;
    }
  }

  const totalRepaid = l1Repay + l2Repay + l3Repay;
  const newHf = currentDebt <= 0 ? Infinity : (currentCollateral * lt) / currentDebt;
  const actionsCount = totalRepaid > 0 ? 1 : 0;
  const status: CascadeStatus =
    totalRepaid === 0 ? "no_action" : newHf >= input.targetHf ? "target_reached" : "partial";

  const remWalletBal = l1Bal === Infinity ? Infinity : Math.max(0, l1Bal - l1Repay);
  const remWalletAllow = l1Allow === Infinity ? Infinity : Math.max(0, l1Allow - l1Repay);
  const feeInfo = calculateFee(totalRepaid, remWalletBal, remWalletAllow);

  return {
    l1Repay,
    l2Repay,
    l3Collateral,
    l3Repay,
    totalRepaid,
    newCollateralUsd: currentCollateral,
    newDebtUsd: currentDebt,
    newHf,
    initialHf,
    targetDebtUsd,
    neededRepayUsd,
    actionsCount,
    status,
    feeEligible,
    fee: feeInfo.fee,
    feeWaived: feeInfo.feeWaived,
  };
}

/**
 * Matematika proteksi Guardian v1 untuk UI dan engine (contracts/src/TahansoeGuardian.sol).
 * Semua nilai on-chain memakai bigint: HF dalam WAD (1e18), nilai "base" Aave dalam USD 8 desimal,
 * liquidation threshold dalam basis point, jumlah token dalam unit terkecil token.
 */

export const WAD = 10n ** 18n;
const BPS = 10_000n;
/** Sama dengan TARGET_BUFFER di kontrak: target dinaikkan 0.01% agar pembulatan Aave tetap lolos target. */
const TARGET_BUFFER = 10n ** 14n;

/** Batas validasi setPolicy di kontrak (revert InvalidPolicy di luar batas ini). */
export const MIN_TRIGGER_HF = 1.05;
export const MAX_TARGET_HF = 3;

export interface PolicyInput {
  triggerHf: number;
  targetHf: number;
  maxRepayPerAction: bigint;
}

/** Pesan kesalahan pertama yang akan membuat setPolicy revert, atau null bila valid. */
export function validatePolicy({ triggerHf, targetHf, maxRepayPerAction }: PolicyInput): string | null {
  if (!Number.isFinite(triggerHf) || triggerHf < MIN_TRIGGER_HF) return `Trigger HF must be at least ${MIN_TRIGGER_HF}`;
  if (!Number.isFinite(targetHf) || targetHf <= triggerHf) return "Target HF must be above the trigger";
  if (targetHf > MAX_TARGET_HF) return `Target HF must be at most ${MAX_TARGET_HF}`;
  if (maxRepayPerAction <= 0n) return "Max repay per action must be above 0";
  return null;
}

/** Mengubah HF desimal (mis. 1.3) menjadi WAD tanpa galat floating point pada 4 desimal pertama. */
export function hfToWad(hf: number): bigint {
  return (BigInt(Math.round(hf * 10_000)) * WAD) / 10_000n;
}

/** Mengubah nilai WAD menjadi angka desimal untuk tampilan. */
export function wadToNumber(value: bigint): number {
  return Number((value * 10_000n) / WAD) / 10_000;
}

/** Mengubah nilai base Aave (USD 8 desimal) menjadi jumlah token, dibulatkan ke atas seperti kontrak. */
export function baseToToken(amountBase: bigint, priceBase: bigint, decimals: number): bigint {
  if (priceBase <= 0n) return 0n;
  const unit = 10n ** BigInt(decimals);
  return (amountBase * unit + priceBase - 1n) / priceBase;
}

export interface AccountData {
  collateralBase: bigint;
  debtBase: bigint;
  liquidationThresholdBps: bigint;
}

/**
 * Nilai base yang harus dilunasi sekarang agar HF kembali ke target.
 * Rumus kontrak: debtTarget = collateral × LT / (target + buffer); repay = debt − debtTarget.
 */
export function repayToTargetBase(account: AccountData, targetHfWad: bigint): bigint {
  const targetDebtBase =
    (account.collateralBase * account.liquidationThresholdBps * WAD) / (BPS * (targetHfWad + TARGET_BUFFER));
  return account.debtBase > targetDebtBase ? account.debtBase - targetDebtBase : 0n;
}

/**
 * Perkiraan repay saat HF tepat menyentuh trigger, dengan asumsi utang stabil dan hanya
 * harga collateral yang turun: pada trigger, collateral × LT = debt × trigger, sehingga
 * repay = debt × (1 − trigger / target). Dipakai sebagai nilai "Recommended" untuk
 * maxRepayPerAction.
 */
export function recommendedRepayBase(debtBase: bigint, triggerHfWad: bigint, targetHfWad: bigint): bigint {
  if (targetHfWad <= triggerHfWad || debtBase <= 0n) return 0n;
  return (debtBase * (targetHfWad - triggerHfWad)) / targetHfWad;
}

/**
 * Berapa kali Guardian masih bisa bertindak dengan cap penuh, dibatasi allowance dan saldo
 * (M1 spec §3.2). < 1 berarti proteksi bisa berhenti diam-diam.
 */
export function remainingActions(allowance: bigint, balance: bigint, maxRepayPerAction: bigint): number {
  if (maxRepayPerAction <= 0n) return 0;
  const byAllowance = allowance / maxRepayPerAction;
  const byBalance = balance / maxRepayPerAction;
  return Number(byAllowance < byBalance ? byAllowance : byBalance);
}

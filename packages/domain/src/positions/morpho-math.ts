/**
 * Matematika Morpho Blue (mengikuti SharesMathLib, MathLib, MorphoBalancesLib). Murni, tanpa I/O.
 */

export const WAD = 10n ** 18n;
export const ORACLE_PRICE_SCALE = 10n ** 36n;
export const VIRTUAL_SHARES = 10n ** 6n;
export const VIRTUAL_ASSETS = 1n;
export const MAX_UINT256 = 2n ** 256n - 1n;

export function mulDivDown(x: bigint, y: bigint, d: bigint): bigint {
  return (x * y) / d;
}

export function mulDivUp(x: bigint, y: bigint, d: bigint): bigint {
  return (x * y + (d - 1n)) / d;
}

/** Shares utang → aset, dibulatkan ke atas (SharesMathLib.toAssetsUp). */
export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
}

/** e^(x·n) − 1 lewat deret Taylor tiga suku (MathLib.wTaylorCompounded). */
export function wTaylorCompounded(x: bigint, n: bigint): bigint {
  const firstTerm = x * n;
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD);
  return firstTerm + secondTerm + thirdTerm;
}

/** totalBorrowAssets setelah bunga sejak `lastUpdate` (MorphoBalancesLib.expectedMarketBalances). */
export function accrueBorrowAssets(
  totalBorrowAssets: bigint,
  borrowRatePerSecond: bigint,
  elapsedSeconds: bigint
): bigint {
  if (elapsedSeconds <= 0n || totalBorrowAssets === 0n || borrowRatePerSecond === 0n) {
    return totalBorrowAssets;
  }
  const interest = mulDivDown(totalBorrowAssets, wTaylorCompounded(borrowRatePerSecond, elapsedSeconds), WAD);
  return totalBorrowAssets + interest;
}

export interface MorphoHealthInput {
  collateral: bigint;     // unit token collateral
  price: bigint;          // IOracle.price(), skala 1e36
  lltv: bigint;           // 1e18
  borrowAssets: bigint;   // unit token pinjaman
}

/**
 * HF Morpho (1e18) = collateral × price / 1e36 × lltv / 1e18 / borrowAssets.
 * Tanpa utang → MAX_UINT256 (konvensi Aave), sehingga HF=1 tepat di batas likuidasi Morpho.
 */
export function morphoHealthFactor({ collateral, price, lltv, borrowAssets }: MorphoHealthInput): bigint {
  if (borrowAssets === 0n) return MAX_UINT256;
  const maxBorrow = mulDivDown(mulDivDown(collateral, price, ORACLE_PRICE_SCALE), lltv, WAD);
  return mulDivDown(maxBorrow, WAD, borrowAssets);
}

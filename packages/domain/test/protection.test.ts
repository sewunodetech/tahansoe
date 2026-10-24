import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WAD,
  validatePolicy,
  hfToWad,
  wadToNumber,
  baseToToken,
  repayToTargetBase,
  recommendedRepayBase,
  remainingActions,
} from "../src/protection";
import { ARBITRUM_ONE, ARBITRUM_SEPOLIA, currentGuardian, legacyGuardians, guardiansFor, latestGuardian, isPerPositionGuardian, type ChainConfig } from "../src/chains";

const USD = (n: number) => BigInt(Math.round(n * 1e8));

describe("validatePolicy mengikuti revert InvalidPolicy kontrak", () => {
  it("menerima policy valid", () => {
    assert.equal(validatePolicy({ triggerHf: 1.3, targetHf: 1.6, maxRepayPerAction: 1n }), null);
  });
  it("menolak trigger < 1.05, target <= trigger, target > 3, cap 0", () => {
    assert.match(validatePolicy({ triggerHf: 1.04, targetHf: 1.6, maxRepayPerAction: 1n })!, /Trigger/);
    assert.match(validatePolicy({ triggerHf: 1.3, targetHf: 1.3, maxRepayPerAction: 1n })!, /above the trigger/);
    assert.match(validatePolicy({ triggerHf: 1.3, targetHf: 3.01, maxRepayPerAction: 1n })!, /at most/);
    assert.match(validatePolicy({ triggerHf: 1.3, targetHf: 1.6, maxRepayPerAction: 0n })!, /above 0/);
  });
});

describe("konversi WAD", () => {
  it("hfToWad tepat untuk 1.3 dan bolak-balik ke angka", () => {
    assert.equal(hfToWad(1.3), 13n * 10n ** 17n);
    assert.equal(wadToNumber(hfToWad(1.65)), 1.65);
  });
});

describe("baseToToken", () => {
  it("USD 8 desimal ke USDC 6 desimal pada harga $1, dibulatkan ke atas", () => {
    assert.equal(baseToToken(USD(500), USD(1), 6), 500_000_000n);
    assert.equal(baseToToken(1n, USD(1), 6), 1n);
  });
  it("harga 0 menghasilkan 0", () => {
    assert.equal(baseToToken(USD(500), 0n, 6), 0n);
  });
});

describe("repayToTargetBase meniru quoteRepay", () => {
  it("collateral $10,000, LT 82.5%, debt $7,000 (HF ≈ 1.18) ke target 1.5", () => {
    const repay = repayToTargetBase(
      { collateralBase: USD(10_000), debtBase: USD(7_000), liquidationThresholdBps: 8_250n },
      hfToWad(1.5)
    );
    // debt target = 8250 / 1.5001 ≈ 5499.63 → repay ≈ 1500.37
    assert.ok(repay > USD(1_500) && repay < USD(1_501), `repay ${repay}`);
  });
  it("0 bila HF sudah di atas target", () => {
    assert.equal(
      repayToTargetBase({ collateralBase: USD(10_000), debtBase: USD(4_000), liquidationThresholdBps: 8_250n }, hfToWad(1.5)),
      0n
    );
  });
});

describe("recommendedRepayBase", () => {
  it("debt × (1 − trigger/target)", () => {
    // 6000 × (1 − 1.3/1.6) = 1125
    assert.equal(recommendedRepayBase(USD(6_000), hfToWad(1.3), hfToWad(1.6)), USD(1_125));
  });
  it("0 bila target <= trigger atau tanpa utang", () => {
    assert.equal(recommendedRepayBase(USD(6_000), hfToWad(1.6), hfToWad(1.6)), 0n);
    assert.equal(recommendedRepayBase(0n, hfToWad(1.3), hfToWad(1.6)), 0n);
  });
});

describe("remainingActions", () => {
  it("minimum dari allowance dan saldo dibagi cap", () => {
    assert.equal(remainingActions(1_000n, 1_500n, 500n), 2);
    assert.equal(remainingActions(1_000n, 400n, 500n), 0);
    assert.equal(remainingActions(1_000n, 1_500n, 0n), 0);
  });
  it("WAD tetap 1e18", () => {
    assert.equal(WAD, 10n ** 18n);
  });
});

describe("versi Guardian", () => {
  it("Arbitrum Sepolia: v1 adalah Guardian klasik terbaru dan sama dengan field guardian", () => {
    assert.equal(currentGuardian(ARBITRUM_SEPOLIA)?.address, ARBITRUM_SEPOLIA.guardian);
    assert.deepEqual(legacyGuardians(ARBITRUM_SEPOLIA), []);
  });
  it("Arbitrum Sepolia: Guardian v4 Aave terdaftar dan ditemukan lewat latestGuardian", () => {
    const v4 = latestGuardian(ARBITRUM_SEPOLIA, "aave-v3");
    assert.equal(v4?.version, 4);
    assert.equal(v4?.address, "0xa7Bbab6366a723e17cd2f220D708757e449571b4");
    assert.equal(isPerPositionGuardian(v4), true);
  });
  it("versi tertinggi menjadi current, sisanya legacy terurut menurun", () => {
    const chain: ChainConfig = {
      ...ARBITRUM_SEPOLIA,
      guardians: [
        { version: 1, address: "0x0000000000000000000000000000000000000001", deployedBlock: 1 },
        { version: 3, address: "0x0000000000000000000000000000000000000003", deployedBlock: 3 },
        { version: 2, address: "0x0000000000000000000000000000000000000002", deployedBlock: 2 },
      ],
    };
    assert.equal(currentGuardian(chain)?.version, 3);
    assert.deepEqual(legacyGuardians(chain).map((g) => g.version), [2, 1]);
  });
  it("chain tanpa deployment: tidak ada current", () => {
    assert.equal(currentGuardian(ARBITRUM_ONE), undefined);
  });
  it("guardiansFor dan latestGuardian membedakan protocol", () => {
    const chain: ChainConfig = {
      ...ARBITRUM_SEPOLIA,
      guardians: [
        { version: 1, address: "0x0000000000000000000000000000000000000001", deployedBlock: 1 },
        { version: 4, address: "0x0000000000000000000000000000000000000004", deployedBlock: 4, protocol: "aave-v3" },
        { version: 1, address: "0x0000000000000000000000000000000000000010", deployedBlock: 10, protocol: "morpho-blue" },
        { version: 2, address: "0x0000000000000000000000000000000000000020", deployedBlock: 20, protocol: "morpho-blue" },
      ],
    };
    assert.equal(guardiansFor(chain, "aave-v3").length, 2);
    assert.equal(guardiansFor(chain, "morpho-blue").length, 2);
    assert.equal(latestGuardian(chain, "aave-v3")?.version, 4);
    assert.equal(latestGuardian(chain, "morpho-blue")?.version, 2);
    // currentGuardian/legacyGuardians hanya Guardian klasik (ABI v1–v3); v4 tidak ikut.
    assert.equal(currentGuardian(chain)?.version, 1);
    assert.deepEqual(legacyGuardians(chain).map((g) => g.version), []);
  });
});

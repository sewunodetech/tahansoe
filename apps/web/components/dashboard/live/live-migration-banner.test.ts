import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import type { GuardianDeployment } from "@tahansoe/domain";
import {
  computeMigrationExposures,
  isMigrationRequired,
} from "./live-migration-banner";
import type { LivePolicy } from "@/hooks/useGuardian";

describe("LiveMigrationBanner visibility and exposure logic", () => {
  const v1Deployment: GuardianDeployment = {
    version: 1,
    address: "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E",
    deployedBlock: 313944170,
  };

  const usdc: Address = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const weth: Address = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73";

  it("returns exposure when user has an active v1 policy but zero allowances", () => {
    const policy: LivePolicy = {
      enabled: true,
      debtAsset: usdc,
      triggerHf: 1.3,
      targetHf: 1.6,
      maxRepayPerAction: 100_000_000n,
    };
    const allowances = [
      { asset: usdc, symbol: "USDC", decimals: 6, amount: 0n },
      { asset: weth, symbol: "WETH", decimals: 18, amount: 0n },
    ];

    const exposures = computeMigrationExposures({
      deployments: [v1Deployment],
      policies: [policy],
      allowances: [allowances],
    });

    assert.equal(exposures.length, 1);
    assert.equal(exposures[0].deployment.address, v1Deployment.address);
    assert.equal(exposures[0].policy?.enabled, true);
    assert.equal(exposures[0].allowances.length, 0);
    assert.equal(isMigrationRequired(exposures), true);
  });

  it("returns exposure when user has a non-zero token allowance on v1 but no policy", () => {
    const allowances = [
      { asset: usdc, symbol: "USDC", decimals: 6, amount: 500_000_000n },
      { asset: weth, symbol: "WETH", decimals: 18, amount: 0n },
    ];

    const exposures = computeMigrationExposures({
      deployments: [v1Deployment],
      policies: [null],
      allowances: [allowances],
    });

    assert.equal(exposures.length, 1);
    assert.equal(exposures[0].deployment.address, v1Deployment.address);
    assert.equal(exposures[0].policy, null);
    assert.equal(exposures[0].allowances.length, 1);
    assert.equal(exposures[0].allowances[0].symbol, "USDC");
    assert.equal(exposures[0].allowances[0].amount, 500_000_000n);
    assert.equal(isMigrationRequired(exposures), true);
  });

  it("returns exposure when user has both an active policy and non-zero allowances", () => {
    const policy: LivePolicy = {
      enabled: true,
      debtAsset: usdc,
      triggerHf: 1.25,
      targetHf: 1.5,
      maxRepayPerAction: 200_000_000n,
    };
    const allowances = [
      { asset: usdc, symbol: "USDC", decimals: 6, amount: 1_000_000_000n },
      { asset: weth, symbol: "WETH", decimals: 18, amount: 1_000_000_000_000_000_000n },
    ];

    const exposures = computeMigrationExposures({
      deployments: [v1Deployment],
      policies: [policy],
      allowances: [allowances],
    });

    assert.equal(exposures.length, 1);
    assert.equal(exposures[0].policy?.enabled, true);
    assert.equal(exposures[0].allowances.length, 2);
    assert.equal(isMigrationRequired(exposures), true);
  });

  it("returns empty exposures when user has disabled policy and zero allowance (clean / migrated state)", () => {
    const disabledPolicy: LivePolicy = {
      enabled: false,
      debtAsset: usdc,
      triggerHf: 1.3,
      targetHf: 1.6,
      maxRepayPerAction: 100_000_000n,
    };
    const zeroAllowances = [
      { asset: usdc, symbol: "USDC", decimals: 6, amount: 0n },
      { asset: weth, symbol: "WETH", decimals: 18, amount: 0n },
    ];

    const exposures = computeMigrationExposures({
      deployments: [v1Deployment],
      policies: [disabledPolicy],
      allowances: [zeroAllowances],
    });

    assert.equal(exposures.length, 0);
    assert.equal(isMigrationRequired(exposures), false);
  });

  it("returns empty exposures when user has never interacted with v1", () => {
    const exposures = computeMigrationExposures({
      deployments: [v1Deployment],
      policies: [null],
      allowances: [[]],
    });

    assert.equal(exposures.length, 0);
    assert.equal(isMigrationRequired(exposures), false);
  });
});

/**
 * Read-only dry-run against Arbitrum Sepolia (Task DT-E acceptance).
 *
 * Menguji keterbacaan kontrak Guardian v4 di Arbitrum Sepolia,
 * membaca konfigurasi policy & trigger band aktif, dan menjalankan
 * DynamicTriggerService dalam mode "dry-run" (tanpa transaksi).
 */

import { createPublicClient, http, getAddress } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { ARBITRUM_SEPOLIA, wadToNumber, type Address } from "@tahansoe/domain";
import { guardianAaveV4Abi } from "../../src/sentinel/abi.ts";
import { DynamicTriggerService } from "../../src/sentinel/dynamic-trigger.ts";
import { InMemorySentinelDatabase } from "../../src/sentinel/db-adapter.ts";
import type { PolicyRecord } from "../../src/sentinel/types.ts";
import { env } from "../../src/config.ts";

async function runDryRun() {
  console.log("=================================================================");
  console.log("   TAHANSOE CORE RISK ENGINE: ARBITRUM SEPOLIA DRY-RUN (DT-E)   ");
  console.log("=================================================================");

  const rpcUrl =
    env.arbitrumSepoliaRpcUrl() ||
    process.env.ARB_SEPOLIA_RPC_URL ||
    "https://sepolia-rollup.arbitrum.io/rpc";

  console.log(`[dry-run] RPC URL: ${rpcUrl}`);
  console.log(`[dry-run] Chain ID: ${ARBITRUM_SEPOLIA.chainId} (${ARBITRUM_SEPOLIA.name})`);
  console.log(`[dry-run] Expected Risk Agent: ${ARBITRUM_SEPOLIA.riskAgent}`);

  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const blockNumber = await client.getBlockNumber();
  console.log(`[dry-run] Current Sepolia Block Number: ${blockNumber.toString()}`);

  const v4Deployment = ARBITRUM_SEPOLIA.guardians?.find((g) => g.version === 4);
  if (!v4Deployment) {
    throw new Error("Guardian v4 deployment not found in ARBITRUM_SEPOLIA config!");
  }

  const guardianAddress = getAddress(v4Deployment.address);
  console.log(`[dry-run] Guardian Aave V4 Address: ${guardianAddress}`);

  // 1. Query position count on-chain
  const positionCount = (await client.readContract({
    address: guardianAddress,
    abi: guardianAaveV4Abi,
    functionName: "positionCount",
  })) as bigint;

  console.log(`[dry-run] On-chain Position Count: ${positionCount.toString()}`);

  // 2. Query positions page
  let activePolicies: PolicyRecord[] = [];

  if (positionCount > 0n) {
    const [users, debtAssets] = (await client.readContract({
      address: guardianAddress,
      abi: guardianAaveV4Abi,
      functionName: "positionsPage",
      args: [0n, positionCount > 10n ? 10n : positionCount],
    })) as [Address[], Address[]];

    console.log(`[dry-run] Fetched ${users.length} positions from on-chain:`);
    for (let i = 0; i < users.length; i++) {
      const u = users[i]!;
      const d = debtAssets[i]!;

      const policyRaw = (await client.readContract({
        address: guardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "policyOf",
        args: [u, d],
      })) as [boolean, bigint, bigint, bigint];

      const effTriggerRaw = (await client.readContract({
        address: guardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "effectiveTrigger",
        args: [u, d],
      })) as bigint;

      console.log(`  Position #${i + 1}: user=${u} debtAsset=${d}`);
      console.log(`    enabled=${policyRaw[0]} staticTrigger=${wadToNumber(policyRaw[1]).toFixed(2)} targetHF=${wadToNumber(policyRaw[2]).toFixed(2)} maxRepay=${policyRaw[3].toString()}`);
      console.log(`    effectiveTrigger=${wadToNumber(effTriggerRaw).toFixed(2)}`);

      if (policyRaw[0]) {
        activePolicies.push({
          id: `onchain-pol-${i}`,
          userId: `user-${i}`,
          userAddress: u,
          chainId: ARBITRUM_SEPOLIA.chainId,
          guardianAddress,
          guardianVersion: 4,
          debtAsset: d,
          maxRepayPerAction: policyRaw[3],
          triggerThreshold: wadToNumber(policyRaw[1]),
          targetHealthFactor: wadToNumber(policyRaw[2]),
          isActive: true,
          minTriggerHf: 1.15,
          maxTriggerHf: 1.45,
          riskAgent: ARBITRUM_SEPOLIA.riskAgent,
          dynamicTriggerHf: null,
          dynamicValidUntil: null,
          protocol: "aave-v3",
        });
      }
    }
  } else {
    console.log("[dry-run] Notice: No positions currently registered on Guardian v4 Sepolia.");
    console.log("[dry-run] Using sample Sepolia position for verification with testnet tokens USDC & WETH...");

    const sampleUser = getAddress("0x4eF8E7A6106Ffc768fcd12b5886319dA71CD42ca");
    const usdc = getAddress(ARBITRUM_SEPOLIA.tokens!.USDC!);

    activePolicies.push({
      id: "sample-pol-sepolia",
      userId: "user-deployer",
      userAddress: sampleUser,
      chainId: ARBITRUM_SEPOLIA.chainId,
      guardianAddress,
      guardianVersion: 4,
      debtAsset: usdc,
      maxRepayPerAction: 1000n * 10n ** 6n,
      triggerThreshold: 1.30,
      targetHealthFactor: 1.60,
      isActive: true,
      minTriggerHf: 1.20,
      maxTriggerHf: 1.50,
      riskAgent: ARBITRUM_SEPOLIA.riskAgent,
      dynamicTriggerHf: null,
      dynamicValidUntil: null,
      protocol: "aave-v3",
    });
  }

  // 3. Setup InMemory Database with non-stale RiskAssessment for ETH
  const db = new InMemorySentinelDatabase();
  const now = new Date();
  const assessmentValidUntil = new Date(now.getTime() + 90 * 60 * 1000); // valid for 90m

  db.latestRiskAssessment = {
    id: "sepolia-dryrun-assessment",
    regime: "ELEVATED",
    validUntil: assessmentValidUntil,
    recommendedTriggerHf: 1.42,
    recommendedTargetHf: 1.60,
    explanation: "Sepolia dry-run test assessment: elevated crypto market volatility detected",
  };

  console.log(`[dry-run] Simulated Market Regime: ${db.latestRiskAssessment.regime}`);
  console.log(`[dry-run] Assessment Recommended Trigger: ${(db.latestRiskAssessment.recommendedTriggerHf ?? 0).toFixed(2)}`);
  console.log(`[dry-run] Assessment Valid Until: ${assessmentValidUntil.toISOString()}`);

  // 4. Initialize DynamicTriggerService in dry-run mode
  const service = new DynamicTriggerService({
    client,
    db,
    chainId: ARBITRUM_SEPOLIA.chainId,
    mode: "dry-run",
    riskAgentAddress: ARBITRUM_SEPOLIA.riskAgent,
    now: () => now,
  });

  console.log(`[dry-run] DynamicTriggerService Mode: ${service.getMode()}`);
  console.log(`[dry-run] DynamicTriggerService Risk Agent: ${service.getRiskAgentAddress()}`);

  // 5. Run evaluation on active policies
  console.log(`[dry-run] Evaluating ${activePolicies.length} policy(ies)...`);
  const decisions = await service.evaluateAll(activePolicies);

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i]!;
    console.log(`--- Policy Evaluation Decision #${i + 1} ---`);
    console.log(`  User: ${d.user}`);
    console.log(`  Debt Asset: ${d.debtAsset}`);
    console.log(`  Status: ${d.status}`);
    console.log(`  Reason: ${d.reason}`);
    console.log(`  Target Trigger HF: ${d.targetTriggerHf ?? "N/A"}`);
    console.log(`  Valid Until (sec): ${d.validUntilSec ?? "N/A"}`);
    if (d.validUntilSec) {
      console.log(`  Valid Until (ISO): ${new Date(d.validUntilSec * 1000).toISOString()}`);
    }
  }

  console.log("=================================================================");
  console.log("   DRY-RUN COMPLETE: ZERO TRANSACTIONS BROADCAST TO SEPOLIA     ");
  console.log("=================================================================");
}

runDryRun().catch((err) => {
  console.error("[dry-run] Error running Sepolia dry-run:", err);
  process.exit(1);
});

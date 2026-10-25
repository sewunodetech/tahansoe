import { parseAbi, type Address, type PublicClient } from "viem";
import type { ChainConfig, GuardianDeployment } from "@tahansoe/domain";

const guardianClassicAbi = parseAbi([
  "function policyOf(address user) external view returns (bool enabled, address debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
]);

const guardianV4Abi = parseAbi([
  "function debtAssetsOf(address user) external view returns (address[])",
]);

/**
 * Pure Sybil filter: filters client addresses based on a validation predicate.
 * ADR 0017: feedback could be spammed (Sybil), so we only count feedback from
 * client addresses that actually have a policy on our Guardians.
 */
export async function filterSybilClients(
  clients: Address[],
  isEligible: (client: Address) => boolean | Promise<boolean>
): Promise<Address[]> {
  const eligible: Address[] = [];
  for (const client of clients) {
    if (await isEligible(client)) {
      eligible.push(client);
    }
  }
  return eligible;
}

/**
 * Checks on-chain whether an address holds a policy on any Guardian contract of the chain.
 */
export async function hasGuardianPolicy(
  client: PublicClient,
  chainConfig: ChainConfig,
  userAddress: Address
): Promise<boolean> {
  const guardians: GuardianDeployment[] = [];
  if (chainConfig.guardians && chainConfig.guardians.length > 0) {
    guardians.push(...chainConfig.guardians);
  } else if (chainConfig.guardian) {
    guardians.push({
      version: 1,
      address: chainConfig.guardian,
      deployedBlock: 0,
      protocol: "aave-v3",
    });
  }

  for (const g of guardians) {
    try {
      if (g.version >= 4) {
        // Guardian v4 (per-position): check if user has configured debt assets
        const assets = await client.readContract({
          address: g.address,
          abi: guardianV4Abi,
          functionName: "debtAssetsOf",
          args: [userAddress],
        });
        if (assets && assets.length > 0) return true;
      } else {
        // Guardian v1-v3 (classic): policyOf returns (enabled, ...)
        const policy = await client.readContract({
          address: g.address,
          abi: guardianClassicAbi,
          functionName: "policyOf",
          args: [userAddress],
        });
        if (policy && (policy[0] === true || policy[4] > 0n)) {
          return true;
        }
      }
    } catch {
      // Contract call reverted or not applicable for this deployment
      continue;
    }
  }

  return false;
}

/**
 * Filters a list of ERC-8004 feedback clients, retaining only those that hold
 * a policy on any configured Guardian contract (Sybil filter, ADR 0017).
 */
export async function filterClientsWithGuardianPolicy(
  client: PublicClient,
  chainConfig: ChainConfig,
  clients: Address[]
): Promise<Address[]> {
  return filterSybilClients(clients, (addr) =>
    hasGuardianPolicy(client, chainConfig, addr)
  );
}

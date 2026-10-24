/**
 * Points AaveOracle's WETH source at SimPriceFeed on a fork, and writes prices to it.
 *
 * Aave and Guardian keep reading AaveOracle (invariant I5); only its WETH source
 * changes, and only on the fork (spec §3.3).
 */

import { encodeFunctionData, getAddress, type Address } from "viem";
import { aaveOracleAbi, aclManagerAbi, poolAddressesProviderAbi, simPriceFeedAbi, SIM_FEED_DECIMALS } from "./abis.ts";
import { FORK_SOURCE } from "./config.ts";
import type { ForkClient } from "./fork-client.ts";

/** Converts a USD price to the feed's 8-decimal integer answer. */
export function toFeedAnswer(priceUsd: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error(`invalid price ${priceUsd}`);
  return BigInt(Math.round(priceUsd * 10 ** SIM_FEED_DECIMALS));
}

export async function writeFeedPrice(fork: ForkClient, feed: Address, updater: Address, priceUsd: number) {
  const data = encodeFunctionData({ abi: simPriceFeedAbi, functionName: "setAnswer", args: [toFeedAnswer(priceUsd)] });
  await fork.sendAs(updater, feed, data);
}

/**
 * Returns an account that may call AaveOracle.setAssetSources on the fork: the Aave ACL
 * admin, granted POOL_ADMIN via impersonation if it does not already hold it.
 */
export async function ensureOracleAdmin(fork: ForkClient): Promise<{ admin: Address; oracle: Address }> {
  const provider = FORK_SOURCE.poolAddressesProvider;
  const [aclManager, admin, oracle] = await Promise.all([
    fork.read<Address>(provider, poolAddressesProviderAbi, "getACLManager"),
    fork.read<Address>(provider, poolAddressesProviderAbi, "getACLAdmin"),
    fork.read<Address>(provider, poolAddressesProviderAbi, "getPriceOracle"),
  ]);
  if (getAddress(oracle) !== getAddress(FORK_SOURCE.aaveOracle)) {
    throw new Error(`AaveOracle mismatch: provider says ${oracle}, registry says ${FORK_SOURCE.aaveOracle}`);
  }
  // The ACL admin holds DEFAULT_ADMIN_ROLE, so it can grant itself POOL_ADMIN if needed.
  const [isPoolAdmin, isListingAdmin] = await Promise.all([
    fork.read<boolean>(aclManager, aclManagerAbi, "isPoolAdmin", [admin]),
    fork.read<boolean>(aclManager, aclManagerAbi, "isAssetListingAdmin", [admin]),
  ]);
  if (!isPoolAdmin && !isListingAdmin) {
    await fork.sendAs(admin, aclManager, encodeFunctionData({ abi: aclManagerAbi, functionName: "addPoolAdmin", args: [admin] }));
  }
  return { admin: getAddress(admin), oracle: getAddress(oracle) };
}

/** Impersonates the Aave ACL admin and calls AaveOracle.setAssetSources([WETH], [feed]). */
export async function switchWethOracle(fork: ForkClient, feed: Address): Promise<void> {
  const { admin, oracle } = await ensureOracleAdmin(fork);
  await fork.sendAs(
    admin,
    oracle,
    encodeFunctionData({ abi: aaveOracleAbi, functionName: "setAssetSources", args: [[FORK_SOURCE.weth], [feed]] }),
  );
  const source = await fork.read<Address>(oracle, aaveOracleAbi, "getSourceOfAsset", [FORK_SOURCE.weth]);
  if (getAddress(source) !== getAddress(feed)) throw new Error("setAssetSources did not take effect");
}

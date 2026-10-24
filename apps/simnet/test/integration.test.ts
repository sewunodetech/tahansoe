/**
 * Optional real-anvil test: fork Arbitrum One, deploy, switch the WETH oracle, move
 * the price, use the faucet. Skips unless `anvil` is on PATH and ARB_ONE_RPC_URL is set.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { aaveOracleAbi } from "../src/abis.ts";
import { startAnvil } from "../src/anvil.ts";
import { FORK_SOURCE } from "../src/config.ts";
import { createDeployer } from "../src/deploy.ts";
import { Faucet } from "../src/faucet.ts";
import { ForkClient } from "../src/fork-client.ts";
import { switchWethOracle, writeFeedPrice } from "../src/oracle.ts";

const rpcUrl = process.env.ARB_ONE_RPC_URL;
const anvilBin = process.env.SIM_ANVIL_BIN ?? "anvil";
const hasAnvil = spawnSync(anvilBin, ["--version"], { stdio: "ignore" }).status === 0;
const skip = !rpcUrl ? "ARB_ONE_RPC_URL not set" : !hasAnvil ? "anvil not on PATH" : false;

describe("simnet on a real anvil fork", { skip }, () => {
  it("deploys, switches the WETH oracle, writes prices and funds a wallet", { timeout: 300_000 }, async () => {
    const chainId = 4216199;
    const anvil = await startAnvil({ bin: anvilBin, forkUrl: rpcUrl!, chainId });
    try {
      const fork = new ForkClient(anvil.url, chainId);
      const d = await createDeployer({ forgeBin: process.env.SIM_FORGE_BIN ?? "forge", simChainId: chainId }).deploy(fork);
      await writeFeedPrice(fork, d.simPriceFeed, d.updater, 2500);
      await switchWethOracle(fork, d.simPriceFeed);
      const price = await fork.read<bigint>(FORK_SOURCE.aaveOracle, aaveOracleAbi, "getAssetPrice", [FORK_SOURCE.weth]);
      assert.equal(price, 2500n * 10n ** 8n);

      const user = "0x00000000000000000000000000000000c0ffee01" as const;
      const faucet = new Faucet(fork);
      await faucet.fund(user, "ETH", 10);
      await faucet.fund(user, "WETH", 2);
      await faucet.fund(user, "USDC", 5000);
      const b = await faucet.balances(user);
      assert.equal(b.WETH, (2n * 10n ** 18n).toString());
      assert.equal(b.USDC, (5000n * 10n ** 6n).toString());
    } finally {
      await anvil.stop();
    }
  });
});

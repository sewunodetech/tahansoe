/**
 * Mainnet price relay: reads Chainlink ETH/USD on Arbitrum One (registry
 * priceFeeds["ETH/USD"]) and fans the price out to every fork still on live price.
 */

import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { arbitrum } from "viem/chains";
import { chainlinkAggregatorAbi } from "./abis.ts";
import { FORK_SOURCE } from "./config.ts";

export type PriceReader = () => Promise<number>;

export function createChainlinkReader(rpcUrl: string, feed: Address = FORK_SOURCE.ethUsdFeed): PriceReader {
  const client: PublicClient = createPublicClient({ chain: arbitrum, transport: http(rpcUrl, { timeout: 10_000 }) });
  let decimals: number | undefined;
  return async () => {
    decimals ??= Number(await client.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "decimals" }));
    const [, answer] = await client.readContract({ address: feed, abi: chainlinkAggregatorAbi, functionName: "latestRoundData" });
    if (answer <= 0n) throw new Error(`non-positive Chainlink answer ${answer}`);
    return Number(answer) / 10 ** decimals;
  };
}

export interface RelayHandle {
  stop(): void;
  latest(): number | null;
}

export function startRelay(
  read: PriceReader,
  onPrice: (price: number) => Promise<void>,
  intervalMs: number,
  onError: (e: unknown) => void,
): RelayHandle {
  let latest: number | null = null;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      latest = await read();
      await onPrice(latest);
    } catch (e) {
      onError(e);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), latest: () => latest };
}

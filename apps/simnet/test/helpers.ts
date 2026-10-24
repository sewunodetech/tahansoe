import type { Address } from "viem";
import type { Faucet, FaucetAsset } from "../src/faucet.ts";
import type { ForkRuntime } from "../src/forks.ts";
import { PriceController } from "../src/price-controller.ts";

export const GUARDIAN: Address = "0x1111111111111111111111111111111111111111";
export const FEED: Address = "0x2222222222222222222222222222222222222222";

/** In-memory faucet: records funding so tests can assert on it. */
export function fakeFaucet() {
  const funded: { holder: Address; asset: FaucetAsset; amount: number }[] = [];
  const faucet = {
    funded,
    async fund(holder: Address, asset: FaucetAsset, amount: number) {
      funded.push({ holder, asset, amount });
    },
    async balances(holder: Address) {
      const sum = (a: FaucetAsset) => funded.filter((f) => f.holder === holder && f.asset === a).reduce((s, f) => s + f.amount, 0);
      return { ETH: String(sum("ETH")), WETH: String(sum("WETH")), USDC: String(sum("USDC")) };
    },
  };
  return faucet as typeof faucet & Faucet;
}

export function fakeRuntime(opts: { onStop?: () => void; price?: number } = {}): ForkRuntime {
  const price = new PriceController(async () => {});
  void price.onMainnetPrice(opts.price ?? 2000);
  return {
    url: "http://127.0.0.1:1",
    deployment: { guardian: GUARDIAN, simPriceFeed: FEED, updater: FEED, method: "artifacts" },
    faucet: fakeFaucet(),
    price,
    events: [],
    stop: async () => opts.onStop?.(),
  };
}

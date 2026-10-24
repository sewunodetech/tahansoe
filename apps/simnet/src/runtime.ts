/**
 * Real ForkFactory: anvil → deploy → seed SimPriceFeed → switch AaveOracle WETH source
 * → start sim keeper and scenario ticker.
 */

import { startAnvil } from "./anvil.ts";
import { LIMITS } from "./config.ts";
import type { Deployer } from "./deploy.ts";
import { Faucet } from "./faucet.ts";
import { ForkClient } from "./fork-client.ts";
import type { ForkFactory, ForkRuntime } from "./forks.ts";
import { startKeeper, type SimEvent } from "./keeper.ts";
import { switchWethOracle, writeFeedPrice } from "./oracle.ts";
import { PriceController } from "./price-controller.ts";

export interface RuntimeDeps {
  anvilBin: string;
  forkUrl: string;
  simChainId: number;
  deployer: Deployer;
  /** Current mainnet price, used to seed the feed before the oracle switch. */
  currentPrice: () => Promise<number>;
  log: (msg: string, extra?: unknown) => void;
}

const MAX_EVENTS_PER_FORK = 500;

export function createForkFactory(deps: RuntimeDeps): ForkFactory {
  return async (forkId) => {
    const t0 = Date.now();
    const anvil = await startAnvil({ bin: deps.anvilBin, forkUrl: deps.forkUrl, chainId: deps.simChainId });
    try {
      const fork = new ForkClient(anvil.url, deps.simChainId);
      const deployment = await deps.deployer.deploy(fork);
      const write = (price: number) => writeFeedPrice(fork, deployment.simPriceFeed, deployment.updater, price);
      const price = new PriceController(write, Date.now, (e) => deps.log(`[${forkId}] price write failed`, e));

      // Seed before switching so Aave never reads an empty feed.
      await price.onMainnetPrice(await deps.currentPrice());
      await switchWethOracle(fork, deployment.simPriceFeed);

      const events: SimEvent[] = [];
      const keeper = startKeeper(
        fork,
        deployment.guardian,
        (evs) => {
          events.push(...evs);
          if (events.length > MAX_EVENTS_PER_FORK) events.splice(0, events.length - MAX_EVENTS_PER_FORK);
        },
        LIMITS.keeperIntervalMs,
        (e) => deps.log(`[${forkId}] keeper error`, e),
      );
      const ticker = setInterval(() => void price.tick(), LIMITS.scenarioTickMs);
      ticker.unref();

      deps.log(`[${forkId}] ready on :${anvil.port} in ${Date.now() - t0} ms (deploy: ${deployment.method})`);
      const runtime: ForkRuntime = {
        url: anvil.url,
        deployment,
        faucet: new Faucet(fork),
        price,
        events,
        stop: async () => {
          keeper.stop();
          clearInterval(ticker);
          await anvil.stop();
          deps.log(`[${forkId}] stopped`);
        },
      };
      return runtime;
    } catch (e) {
      await anvil.stop();
      throw e;
    }
  };
}

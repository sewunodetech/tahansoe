/**
 * Simnet entry point: `npm run simnet` (root) or `npm start -w @tahansoe/simnet`.
 * See apps/simnet/README.md, docs/specs/m1-simulation-mode.md, ADR 0014.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { killAllAnvils } from "./anvil.ts";
import { LIMITS, loadEnv } from "./config.ts";
import { createDeployer } from "./deploy.ts";
import { ForkManager, msUntilNextDailyReset } from "./forks.ts";
import { createSimnetServer, forwardToAnvil } from "./http.ts";
import { createChainlinkReader, startRelay } from "./relay.ts";
import { createForkFactory } from "./runtime.ts";
import { loadScenarios } from "./scenario.ts";
import { SessionService } from "./sessions.ts";

const log = (msg: string, extra?: unknown) => {
  const detail = extra instanceof Error ? extra.message : extra;
  console.log(`[simnet] ${new Date().toISOString()} ${msg}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
};

async function main() {
  const env = loadEnv();
  const scenariosDir = env.SIM_SCENARIOS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../scenarios");
  const scenarios = loadScenarios(scenariosDir, (file, e) => log(`skipping scenario ${file}`, e));
  log(`loaded ${scenarios.size} scenario(s): ${[...scenarios.keys()].join(", ") || "none"}`);

  const readMainnet = createChainlinkReader(env.ARB_ONE_RPC_URL);
  let lastMainnet: number | null = null;

  const factory = createForkFactory({
    anvilBin: env.SIM_ANVIL_BIN,
    forkUrl: env.ARB_ONE_RPC_URL,
    simChainId: env.SIM_CHAIN_ID,
    deployer: createDeployer({ contractsDir: env.SIM_CONTRACTS_DIR, forgeBin: env.SIM_FORGE_BIN, simChainId: env.SIM_CHAIN_ID }),
    currentPrice: async () => lastMainnet ?? (lastMainnet = await readMainnet()),
    log,
  });

  let sessions: SessionService | undefined;
  const forks = new ForkManager(factory, {
    maxPrivate: env.SIM_MAX_PRIVATE_FORKS,
    ttlMs: env.SIM_PRIVATE_TTL_MIN * 60_000,
    onForkGone: (id) => sessions?.forkGone(id),
    onError: (e) => log("fork stop failed", e),
  });
  sessions = new SessionService(forks, scenarios, env.SIM_CHAIN_ID);

  // Price relay → every fork still following mainnet.
  const relay = startRelay(
    readMainnet,
    async (price) => {
      lastMainnet = price;
      const targets = [forks.currentLive(), ...forks.privateRecords()];
      await Promise.all(targets.map((f) => f?.runtime.price.onMainnetPrice(price)));
    },
    LIMITS.relayIntervalMs,
    (e) => log("relay failed", e),
  );

  const sweeper = setInterval(() => {
    void forks.sweep().then((ids) => ids.length && log(`expired private forks: ${ids.join(", ")}`));
  }, 5_000);
  sweeper.unref();

  let resetTimer: NodeJS.Timeout | undefined;
  const scheduleReset = () => {
    const ms = msUntilNextDailyReset(Date.now(), LIMITS.liveResetHourUtc);
    resetTimer = setTimeout(async () => {
      log("daily reset of the live fork");
      await forks.resetLive().catch((e) => log("live reset failed", e));
      scheduleReset();
    }, ms);
    resetTimer.unref();
  };
  scheduleReset();

  const server = createSimnetServer({
    apiKey: env.SIMNET_API_KEY,
    sessions,
    forks,
    forwardToFork: forwardToAnvil,
    trustProxy: env.SIM_TRUST_PROXY === "1",
    log,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal}: stopping forks`);
    relay.stop();
    clearInterval(sweeper);
    if (resetTimer) clearTimeout(resetTimer);
    server.close();
    await forks.stopAll().catch(() => undefined);
    killAllAnvils();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // Windows: Ctrl+Break and closing the console window. A hard kill (Task Manager, TerminateProcess)
  // cannot be caught; anvil children then outlive simnet and must be stopped by hand.
  process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
  process.on("exit", killAllAnvils);

  server.listen(env.SIM_PORT, () => log(`listening on :${env.SIM_PORT} (chainId ${env.SIM_CHAIN_ID})`));

  // Start the shared live fork in the background; sessions await it if it is not ready.
  forks.live().catch((e) => log("live fork failed to start (will retry on first session)", e));
}

main().catch((e) => {
  console.error("[simnet] fatal:", e instanceof Error ? e.message : e);
  killAllAnvils();
  process.exit(1);
});

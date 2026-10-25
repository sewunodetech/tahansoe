/**
 * Scenario loader and standard synthetic position fixtures.
 * (spec m4-protection-strategy-agent §3.5, docs/knowledge/risk-transmission.md §3).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProtectionScenario, SyntheticPositionConfig } from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, "fixtures");

/** Default debt asset is Arbitrum native USDC. */
export const DEFAULT_DEBT_ASSET = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC",
  decimals: 6,
  priceUsd: 1.0,
};

/** Create standard synthetic positions scaled to a scenario's starting price. */
export function createDefaultPositions(startingCollateralPrice: number): SyntheticPositionConfig[] {
  return [
    {
      positionKey: "aave-v3:42161:moderate:weth-usdc",
      collateralAsset: {
        symbol: "WETH",
        decimals: 18,
        initialPriceUsd: startingCollateralPrice,
      },
      debtAsset: DEFAULT_DEBT_ASSET,
      liquidationThreshold: 0.825,
      initialHf: 1.45,
      initialDebtBase: 10_000_000_000n, // 10,000 USDC
      policy: {
        triggerHf: 1.25,
        targetHf: 1.6,
        maxRepayPerAction: 3_000_000_000n, // 3,000 USDC
      },
      initialReserves: {
        wallet: 6_000_000_000n,
        vault: 6_000_000_000n,
      },
    },
    {
      positionKey: "aave-v3:42161:aggressive:weth-usdc",
      collateralAsset: {
        symbol: "WETH",
        decimals: 18,
        initialPriceUsd: startingCollateralPrice,
      },
      debtAsset: DEFAULT_DEBT_ASSET,
      liquidationThreshold: 0.825,
      initialHf: 1.3,
      initialDebtBase: 20_000_000_000n, // 20,000 USDC
      policy: {
        triggerHf: 1.2,
        targetHf: 1.5,
        maxRepayPerAction: 6_000_000_000n, // 6,000 USDC
      },
      initialReserves: {
        wallet: 10_000_000_000n,
        vault: 10_000_000_000n,
      },
    },
    {
      positionKey: "aave-v3:42161:conservative:weth-usdc",
      collateralAsset: {
        symbol: "WETH",
        decimals: 18,
        initialPriceUsd: startingCollateralPrice,
      },
      debtAsset: DEFAULT_DEBT_ASSET,
      liquidationThreshold: 0.825,
      initialHf: 1.65,
      initialDebtBase: 15_000_000_000n, // 15,000 USDC
      policy: {
        triggerHf: 1.35,
        targetHf: 1.75,
        maxRepayPerAction: 4_500_000_000n, // 4,500 USDC
      },
      initialReserves: {
        wallet: 10_000_000_000n,
        vault: 10_000_000_000n,
      },
    },
  ];
}

/** Load a single scenario by its ID from the fixtures directory. */
export function loadScenario(id: string): ProtectionScenario {
  const filePath = path.join(FIXTURES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Scenario fixture not found: ${id} at ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const raw = JSON.parse(content) as ProtectionScenario;
  if (!raw.points || raw.points.length === 0) {
    throw new Error(`Scenario ${id} contains no price points`);
  }
  const startingPrice = raw.points[0]!.price;
  const positions = raw.positions && raw.positions.length > 0 ? raw.positions : createDefaultPositions(startingPrice);
  return {
    ...raw,
    positions,
  };
}

/** List all available scenario IDs from the fixtures directory. */
export function listScenarioIds(): string[] {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort((a, b) => {
      // Keep calm period at the end for clean reporting
      if (a.startsWith("calm")) return 1;
      if (b.startsWith("calm")) return -1;
      return a.localeCompare(b);
    });
}

/** Load all available scenarios from the fixtures directory. */
export function loadAllScenarios(): ProtectionScenario[] {
  const ids = listScenarioIds();
  return ids.map((id) => loadScenario(id));
}

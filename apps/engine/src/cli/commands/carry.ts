/**
 * `tahansoe carry [--json]` (spec m3-carry-interest-monitoring §3.6).
 *
 * Menampilkan ringkasan risiko bunga & carry Aave V3 Arbitrum One:
 *  - Tabel reserve: supply APY, borrow APY, util / kink, status (ok / near kink / past kink).
 *  - Tabel pair representatif: net carry, hari drift HF 1.50 -> 1.45, dan skenario lonjakan utilization 95%.
 *  - Footer: "informational · not investment advice".
 *
 * PENTING: Tanpa kata "best", "recommend", "switch", "should buy", "should sell" (PRD §11 Non-Goals).
 */

import { parseArgs } from "node:util";
import {
  fetchAaveRates,
  netCarry,
  daysUntilHf,
  borrowAprAt,
  type AaveRatesResult,
  type ReserveRate,
} from "../../sources/aave-rates.ts";
import { REPRESENTATIVE_PAIRS } from "../../signals/carry.ts";
import { detectTheme, banner, dim, bold, table, type TableColumn } from "../render.ts";
import { EXIT_OK, EXIT_ERROR, flagOrNpm } from "./args.ts";

export const CARRY_HELP = `tahansoe carry — Aave V3 Arbitrum One carry & interest-rate monitor

Usage: tahansoe carry [--json] [--no-color]
  --json       Emit machine-readable JSON on stdout
  --no-color   Disable ANSI colors`;

export const CARRY_FOOTER = "informational · not investment advice";
/** Catatan: yield staking LST (wstETH, rETH, weETH, …) tidak tercatat di Aave, jadi carry LST di sini konservatif. */
export const LST_NOTE = "LST staking yield (e.g. wstETH ~3%/yr) is not included: LST carry shown here is conservative";

export interface CarryDeps {
  fetchRates?: () => Promise<AaveRatesResult>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export type ReserveStatus = "ok" | "near kink" | "past kink";

export function getReserveStatus(utilization: number, optimalUtil: number | null): ReserveStatus {
  if (optimalUtil === null) return "ok";
  if (utilization >= optimalUtil) return "past kink";
  if (utilization >= optimalUtil - 0.03) return "near kink";
  return "ok";
}

export async function carryCommand(argv: string[], deps: CarryDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        json: { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }

  if (parsed.values.help) {
    writeOut(CARRY_HELP + "\n");
    return EXIT_OK;
  }

  const json = flagOrNpm(parsed.values.json, "json");

  const fetchFn = deps.fetchRates ?? (() => fetchAaveRates());
  let ratesResult: AaveRatesResult;
  try {
    ratesResult = await fetchFn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) writeOut(JSON.stringify({ ok: false, error: msg }) + "\n");
    else writeErr(`gagal membaca rate Aave V3: ${msg}\n`);
    return EXIT_ERROR;
  }

  const reserves = ratesResult.reserves;
  const reserveMap = new Map<string, ReserveRate>();
  for (const r of reserves) {
    reserveMap.set(r.asset.toUpperCase(), r);
  }

  // Format data reserves untuk output
  const reserveRowsData = reserves.map((r) => {
    const optimal = r.curve?.optimalUtil ?? null;
    const status = getReserveStatus(r.utilization, optimal);
    return {
      asset: r.asset,
      address: r.address,
      supplyApr: r.supplyApr,
      supplyApy: r.supplyApy,
      borrowApr: r.borrowApr,
      borrowApy: r.borrowApy,
      utilization: r.utilization,
      optimalUtil: optimal,
      status,
    };
  });

  // Format data pairs untuk output
  const pairsData = REPRESENTATIVE_PAIRS.map((pair) => {
    const coll = reserveMap.get(pair.collateral.toUpperCase());
    const debt = reserveMap.get(pair.debt.toUpperCase());

    if (!coll || !debt) {
      return {
        collateral: pair.collateral,
        debt: pair.debt,
        available: false,
        netCarry: null,
        daysHf150To145: null,
        scenario95: null,
      };
    }

    const carry = netCarry(coll.supplyApr, debt.borrowApr);
    const days = daysUntilHf(1.50, 1.45, carry);

    let scenario95: {
      targetUtil: number;
      projectedBorrowApr: number;
      projectedNetCarry: number;
      projectedDays: number | null;
    } | null = null;

    if (debt.curve) {
      const projBorrow = borrowAprAt(0.95, debt.curve);
      const projCarry = netCarry(coll.supplyApr, projBorrow);
      const projDays = daysUntilHf(1.50, 1.45, projCarry);
      scenario95 = {
        targetUtil: 0.95,
        projectedBorrowApr: projBorrow,
        projectedNetCarry: projCarry,
        projectedDays: projDays,
      };
    }

    return {
      collateral: pair.collateral,
      debt: pair.debt,
      available: true,
      netCarry: carry,
      daysHf150To145: days,
      scenario95,
    };
  });

  if (json) {
    writeOut(
      JSON.stringify(
        {
          ok: true,
          chainId: 42161,
          sampledAt: ratesResult.sampledAt.toISOString(),
          reserves: reserveRowsData,
          pairs: pairsData,
          warnings: ratesResult.warnings,
          notes: [LST_NOTE],
          footer: CARRY_FOOTER,
        },
        null,
        2,
      ) + "\n",
    );
    return EXIT_OK;
  }

  // Teks terminal
  const theme = detectTheme(argv, process.env, process.stdout);
  const outLines: string[] = [];

  outLines.push(banner(theme, "carry & interest · Aave V3 Arbitrum One"));
  outLines.push("");

  // 1. Reserve Table
  const reserveCols: TableColumn[] = [
    { key: "asset", header: "Reserve", align: "left", width: 10 },
    { key: "supplyApy", header: "Supply APY", align: "right", width: 12 },
    { key: "borrowApy", header: "Borrow APY", align: "right", width: 12 },
    { key: "utilKink", header: "Util / kink", align: "right", width: 14 },
    { key: "status", header: "Status", align: "left", width: 14 },
  ];

  // Prioritaskan aset pair umum & stablecoin di atas
  const priorityAssets = ["USDC", "WETH", "wstETH", "USDT", "WBTC", "USDC.e", "DAI", "GHO"];
  const sortedReserves = [...reserveRowsData].sort((a, b) => {
    const ia = priorityAssets.indexOf(a.asset);
    const ib = priorityAssets.indexOf(b.asset);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.asset.localeCompare(b.asset);
  });

  const reserveTableRows = sortedReserves.map((r) => {
    const utilPct = `${(r.utilization * 100).toFixed(1)}%`;
    const kinkPct = r.optimalUtil !== null ? `${(r.optimalUtil * 100).toFixed(0)}%` : "—";
    let statusText: string = r.status;
    if (r.status === "past kink") statusText = "▲ past kink";
    else if (r.status === "near kink") statusText = "▲ near kink";

    return {
      asset: r.asset,
      supplyApy: `${(r.supplyApy * 100).toFixed(1)}%`,
      borrowApy: `${(r.borrowApy * 100).toFixed(1)}%`,
      utilKink: `${utilPct} / ${kinkPct}`,
      status: statusText,
    };
  });

  outLines.push(table(theme, reserveCols, reserveTableRows));
  outLines.push("");

  // 2. Pair Table
  const pairCols: TableColumn[] = [
    { key: "pair", header: "Pair (coll → debt)", align: "left", width: 22 },
    { key: "netCarry", header: "Net carry", align: "right", width: 14 },
    { key: "hfDrift", header: "HF 1.50 → 1.45", align: "right", width: 16 },
  ];

  const pairTableRows = pairsData
    .filter((p) => p.available)
    .map((p) => {
      const carry = p.netCarry!;
      const carryStr =
        carry < 0
          ? `−${Math.abs(carry * 100).toFixed(1)}%/yr`
          : `+${(carry * 100).toFixed(1)}%/yr`;
      const driftStr =
        p.daysHf150To145 !== null
          ? `≈ ${Math.round(p.daysHf150To145)} days`
          : "stable (positive)";

      return {
        pair: `${p.collateral} → ${p.debt}`,
        netCarry: carryStr,
        hfDrift: driftStr,
      };
    });

  outLines.push(table(theme, pairCols, pairTableRows));

  // Skenario jika debt reserve mencapai 95% util
  const scenarioLines: string[] = [];
  for (const p of pairsData) {
    if (p.scenario95 && p.scenario95.projectedDays !== null) {
      const debtAprPct = (p.scenario95.projectedBorrowApr * 100).toFixed(0);
      const days = Math.round(p.scenario95.projectedDays);
      scenarioLines.push(
        ` if ${p.debt} reaches 95% util (≈ ${debtAprPct}% APR) in ${p.collateral}→${p.debt} → ≈ ${days} days`,
      );
    }
  }

  if (scenarioLines.length > 0) {
    outLines.push("");
    for (const scn of scenarioLines.slice(0, 3)) {
      outLines.push(dim(theme, scn));
    }
  }

  outLines.push("");
  outLines.push(dim(theme, ` note: ${LST_NOTE}`));
  outLines.push(dim(theme, ` ${CARRY_FOOTER}`));

  writeOut(outLines.join("\n") + "\n");
  return EXIT_OK;
}

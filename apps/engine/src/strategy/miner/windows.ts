/**
 * Katalog Jendela Crash Historis Arbitrum One untuk Survivor Miner.
 *
 * Mengacu pada PRD §6.4 dan docs/knowledge/risk-transmission.md §3.
 * Blok-blok ini berada di Arbitrum One (chainId 42161).
 */

import type { CrashWindow } from "./types.ts";

export const HISTORICAL_CRASH_WINDOWS: CrashWindow[] = [
  {
    id: "usdc-depeg-mar-2023",
    name: "USDC Depeg & SVB Collapse (Mar 2023)",
    description:
      "Krisis perbankan SVB memicu depeg USDC ke kisaran $0.87–0.88. Utang stablecoin bergerak tanpa penurunan ETH. Jalur transmisi T4 dominan.",
    startDate: "2023-03-10T00:00:00Z",
    endDate: "2023-03-13T23:59:59Z",
    startBlock: 69_400_000n,
    endBlock: 70_800_000n,
    drawdownStartBlock: 69_850_000n,
    dominantPaths: ["T4"],
    referenceAsset: "USDC",
  },
  {
    id: "yen-carry-aug-2024",
    name: "Yen Carry Trade Unwind (Agu 2024)",
    description:
      "Kenaikan suku bunga Bank of Japan memicu unwind carry trade global, likuidasi pasar saham, dan penurunan tajam harga ETH/BTC. Jalur T1 & T3 dominan.",
    startDate: "2024-08-02T00:00:00Z",
    endDate: "2024-08-06T23:59:59Z",
    startBlock: 238_800_000n,
    endBlock: 240_400_000n,
    drawdownStartBlock: 239_500_000n,
    dominantPaths: ["T1", "T3"],
    referenceAsset: "WETH",
  },
  {
    id: "tariff-crash-oct-2025",
    name: "US-China Tariff Escalation Crash (Okt 2025)",
    description:
      "Pengumuman tarif dadakan memicu likuidasi cascade besar-besaran di derivatif dan spot, disertai kongesti gas jaringan. Jalur T1, T3, T6 dominan.",
    startDate: "2025-10-10T00:00:00Z",
    endDate: "2025-10-13T23:59:59Z",
    startBlock: 360_000_000n,
    endBlock: 362_000_000n,
    drawdownStartBlock: 360_700_000n,
    dominantPaths: ["T1", "T3", "T6"],
    referenceAsset: "WETH",
  },
];

/** Dapatkan window berdasarkan ID, atau undefined jika tidak ditemukan. */
export function getCrashWindowById(id: string): CrashWindow | undefined {
  return HISTORICAL_CRASH_WINDOWS.find((w) => w.id === id);
}

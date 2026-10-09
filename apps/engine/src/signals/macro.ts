/**
 * Deterministic Macro Calendar Signal Module (spec m2-deterministic-signal-modules §3.4).
 *
 * Mengonversi event makro terjadwal (FOMC, CPI, NFP) dalam 48 jam ke depan menjadi sinyal MACRO.
 * Sinyal ini memicu aturan R-MACRO-SOON (horizon <= 18 jam -> floor ELEVATED) di fusion.
 *
 * Aturan:
 * - Horizon = jam sampai event (field yang dibaca oleh macroHorizon() di regime.ts)
 * - Severity: FOMC = 0.6, CPI = 0.5, NFP = 0.4
 * - Paths: T1 + T2
 * - Confidence: 0.95 (jadwal resmi pemerintah / bank sentral)
 * - Direction: "VOLATILITY"
 * - expiresAt = scheduledAt + 6 jam (periode volatilitas pasca-rilis)
 *
 * Fungsi MURNI tanpa I/O.
 */

import type { Signal, TransmissionPath } from "@tahansoe/domain";

export interface ScheduledMacroEvent {
  id?: string;
  name: string;
  scheduledAt: Date;
  importance?: "HIGH" | "MEDIUM" | "LOW";
}

export interface MacroSignalParams {
  chainId?: number;
  now?: Date;
  events: ScheduledMacroEvent[];
  maxHorizonHours?: number; // default 48 jam
}

export const MACRO_MAX_HORIZON_HOURS = 48;
export const MACRO_CONFIDENCE = 0.95;
export const MACRO_POST_RELEASE_HOURS = 6;

let macroSeq = 0;
function genId(): string {
  macroSeq = (macroSeq + 1) % 1_000_000;
  return `sig-macro-${Date.now()}-${macroSeq}`;
}

/**
 * Hitung sinyal deterministik kalender MACRO.
 */
export function computeMacroSignals(params: MacroSignalParams): Signal[] {
  const now = params.now ?? new Date();
  const maxHours = params.maxHorizonHours ?? MACRO_MAX_HORIZON_HOURS;
  const signals: Signal[] = [];

  for (const event of params.events) {
    const schedTime = event.scheduledAt instanceof Date ? event.scheduledAt.getTime() : new Date(event.scheduledAt).getTime();
    const nowTime = now.getTime();
    const horizonHours = (schedTime - nowTime) / 3_600_000;

    // Filter event dalam rentang masa depan [0, maxHours]
    if (horizonHours < 0 || horizonHours > maxHours) {
      continue;
    }

    const upper = event.name.toUpperCase();
    let severity = 0.3;
    if (upper.includes("FOMC")) {
      severity = 0.6;
    } else if (upper.includes("CPI")) {
      severity = 0.5;
    } else if (upper.includes("NFP")) {
      severity = 0.4;
    } else if (event.importance === "HIGH") {
      severity = 0.5;
    }

    const expiresAt = new Date(schedTime + MACRO_POST_RELEASE_HOURS * 3_600_000);

    let tag = "EVENT";
    if (upper.includes("FOMC")) tag = "FOMC";
    else if (upper.includes("CPI")) tag = "CPI";
    else if (upper.includes("NFP")) tag = "NFP";
    else tag = event.name.replace(/[^a-zA-Z0-9]/g, "");

    const dateStr = new Date(schedTime).toISOString().slice(0, 10);
    const dedupeKey = `MACRO:${tag}:${dateStr}`;

    signals.push({
      id: genId(),
      module: "MACRO",
      paths: ["T1" as TransmissionPath, "T2" as TransmissionPath],
      assets: ["ETH"],
      direction: "VOLATILITY",
      severity,
      confidence: MACRO_CONFIDENCE,
      horizonHours, // Dibaca oleh macroHorizon(s) di regime.ts!
      observedAt: now,
      expiresAt,
      dedupeKey,
      evidence: [
        {
          title: `${event.name} scheduled in ${horizonHours.toFixed(1)}h (${new Date(schedTime).toISOString()})`,
          source: "macro_calendar",
          dedupeKey,
        },
      ],
    });
  }

  return signals;
}

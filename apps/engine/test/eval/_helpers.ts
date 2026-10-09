/**
 * Builder ResearchInputs untuk kasus eval (test/eval/cases/*).
 *
 * Semua teks eksternal (headline/excerpt) adalah DATA; set injection sengaja
 * menaruh instruksi jahat di dalamnya untuk menguji G3 (prompt injection).
 */

import type {
  ResearchInputs,
} from "../../src/sources/collect.ts";
import type {
  ContextMacroEvent,
  ContextMarketEvent,
  ContextSignal,
} from "../../src/agents/context.ts";
import type { TransmissionPath } from "../../src/agents/schemas.ts";

const BASE = new Date("2026-10-08T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(BASE.getTime() - h * 60 * 60 * 1000);
const hoursAhead = (h: number) => new Date(BASE.getTime() + h * 60 * 60 * 1000);

let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

export function news(
  category: string,
  headline: string,
  excerpt: string,
  hAgo = 3,
): ContextMarketEvent {
  return { id: nid("evt"), category, headline, publishedAt: hoursAgo(hAgo), excerpt };
}

export function macro(
  name: string,
  importance: ContextMacroEvent["importance"],
  hAhead: number,
): ContextMacroEvent {
  return { id: nid("macro"), name, importance, scheduledAt: hoursAhead(hAhead) };
}

export function signal(
  module: string,
  severity: number,
  summary: string,
  paths?: TransmissionPath[],
): ContextSignal {
  return {
    id: nid("sig"),
    module,
    severity,
    confidence: 0.5,
    paths,
    summary,
    createdAt: hoursAgo(1),
    expiresAt: hoursAhead(1),
  };
}

export function inputs(parts: Partial<ResearchInputs>): ResearchInputs {
  return {
    marketEvents: parts.marketEvents ?? [],
    macroEvents: parts.macroEvents ?? [],
    signals: parts.signals ?? [],
    chainNotes: parts.chainNotes ?? [
      "Arbitrum One: AaveOracle USDC capped; sequencer currently UP.",
    ],
    warnings: parts.warnings ?? [],
  };
}

/** Satu set berita "normal" netral untuk konteks dasar. */
export function calmNews(): ContextMarketEvent[] {
  return [
    news("crypto:CoinDesk", "ETH trades sideways in quiet session", "Low volatility; range-bound price action."),
    news("macro:CNBC", "Markets steady ahead of data", "No major catalysts on the calendar today."),
  ];
}

/** Sinyal on-chain normal (tenang). */
export function calmSignals(): ContextSignal[] {
  return [
    signal("ONCHAIN", 0.15, "Reserve utilization normal (~55%)", ["T7"]),
    signal("ORACLE", 0.1, "Oracle feeds fresh; no deviation", ["T8"]),
  ];
}

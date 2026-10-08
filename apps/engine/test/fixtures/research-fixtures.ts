/**
 * Fixtures deterministik untuk end-to-end run dalam mode --fake (tanpa API).
 *
 * Dipakai oleh FakeProvider (queue berdasarkan urutan panggilan). Urutan panggilan
 * dalam runResearch: 4 analyst (ANALYSTS order: GEOPOLITICS, MACRO, MARKET, ONCHAIN)
 * → debat (hawk, dove) → assessor. Fixture di bawah mengikuti urutan itu.
 *
 * Semua data lolos schema zod di src/agents/schemas.ts.
 */

import type { ScriptedResponse } from "../fake-provider.ts";
import type {
  AnalystReport,
  DebateTurn,
  ResearchReport,
} from "../../src/agents/schemas.ts";
import type { ResearchInputCollector } from "../../src/agents/context.ts";

function analyst(
  domain: AnalystReport["domain"],
  path: AnalystReport["findings"][number]["path"],
  severity: number,
): AnalystReport {
  return {
    domain,
    findings: [
      {
        path,
        severity,
        rationale: `${domain} finding on ${path} (fixture).`,
        evidence: [{ summary: "fixture evidence", source: "SIGNAL" }],
      },
    ],
    summary: `${domain} summary (fixture).`,
  };
}

function hawk(): DebateTurn {
  return {
    side: "HAWK",
    argument: "Combined T1+T3 pressure suggests rising downside risk (fixture).",
    pathsHighlighted: ["T1", "T3"],
  };
}

function dove(): DebateTurn {
  return {
    side: "DOVE",
    argument: "Signals look largely priced in; buffer increase may be premature (fixture).",
    pathsHighlighted: ["T1"],
    rebuttal: "Hawk overweights thin-liquidity moves (fixture).",
  };
}

function report(): ResearchReport {
  return {
    assets: ["ETH", "USDC"],
    proposedRegime: "ELEVATED",
    direction: "DOWN",
    paths: [
      { path: "T1", severity: 0.45, rationale: "Price downside risk (fixture)." },
      { path: "T3", severity: 0.5, rationale: "Leverage cascade risk (fixture)." },
    ],
    keyDevelopments: [
      {
        summary: "Risk-off tone across market signals (fixture).",
        evidence: [{ summary: "fixture development evidence", source: "MARKET" }],
      },
    ],
    hawkCase: "Downside and leverage risks are rising (fixture).",
    doveCase: "Most of the move appears already priced in (fixture).",
    confidence: 0.5,
    horizonHours: 24,
  };
}

/**
 * Script lengkap satu run yang sukses: 4 analyst + hawk + dove + assessor.
 * Jumlah ronde debat default = 1 (config.debateRounds), jadi 2 giliran debat.
 */
export function fakeScript(): ScriptedResponse[] {
  return [
    { data: analyst("GEOPOLITICS", "T9", 0.2) },
    { data: analyst("MACRO", "T1", 0.3) },
    { data: analyst("MARKET", "T3", 0.5) },
    { data: analyst("ONCHAIN", "T4", 0.35) },
    { data: hawk() },
    { data: dove() },
    { data: report() },
  ];
}

/**
 * Collector input deterministik & OFFLINE (tanpa jaringan). Dipakai di test dan
 * mode CLI --fake agar `research:dry` bisa jalan tanpa menyentuh GDELT/RPC.
 * Signature identik dengan collectResearchInputs (ResearchInputCollector).
 */
export const fixtureCollector: ResearchInputCollector = async (opts) => {
  const now = opts.now ?? new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
  return {
    marketEvents: [
      {
        id: "fx-evt-1",
        headline: "Geopolitical tension escalates (fixture).",
        category: "geopolitics:BBC",
        publishedAt: hoursAgo(3),
        excerpt: "Fixture geopolitics event excerpt (treated as DATA).",
      },
      {
        id: "fx-evt-2",
        headline: "Another geopolitics wire update (fixture).",
        category: "geopolitics:BBC",
        publishedAt: hoursAgo(5),
        excerpt: "Fixture geopolitics event excerpt 2 (treated as DATA).",
      },
      {
        id: "fx-evt-3",
        headline: "Crypto market risk-off (fixture).",
        category: "crypto:CoinDesk",
        publishedAt: hoursAgo(2),
        excerpt: "Fixture crypto event excerpt (treated as DATA).",
      },
    ],
    macroEvents: [
      {
        id: "fx-macro-1",
        name: "FOMC decision (fixture)",
        scheduledAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        importance: "HIGH",
      },
    ],
    signals: [
      {
        id: "fx-sig-1",
        module: "ONCHAIN",
        severity: 0.4,
        confidence: 0.5,
        paths: ["T4"],
        summary: "Fixture on-chain observation.",
        createdAt: hoursAgo(1),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      },
      {
        id: "fx-sig-2",
        module: "ORACLE",
        severity: 0.3,
        confidence: 0.5,
        paths: ["T8"],
        summary: "Fixture oracle staleness observation.",
        createdAt: hoursAgo(1),
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      },
    ],
    chainNotes: ["fixture: USDC capped at AaveOracle; no PriceOracleSentinel"],
    // Warning sumber disimpan terpisah dari chainNotes (audit, G7).
    warnings: ["FRED: FRED_API_KEY tidak dikonfigurasi"],
  };
};

/**
 * Set eval "scenarios" (spec §6): snapshot input kondisi jelas dengan regime yang
 * disepakati sebagai RENTANG (bukan satu nilai). Dipakai untuk mengukur kesesuaian
 * regime (target spec §3.4: ≥ 70% kesesuaian scenarios).
 */

import type { EvalCase } from "../../../src/eval/types.ts";
import { inputs, calmNews, calmSignals, news, macro, signal } from "../_helpers.ts";

export const scenarioCases: EvalCase[] = [
  {
    id: "scn-calm",
    set: "scenarios",
    description: "Quiet market, no catalysts → CALM",
    inputs: inputs({ marketEvents: calmNews(), signals: calmSignals() }),
    expect: { regimeAtMost: "ELEVATED", maxSignalConfidence: 0.6 },
    // Kondisi tenang; idealnya CALM, toleransi s.d. ELEVATED.
  },
  {
    id: "scn-fomc-soon",
    set: "scenarios",
    description: "Scheduled FOMC < 24h → ≥ ELEVATED",
    inputs: inputs({
      marketEvents: [...calmNews(), news("macro:Federal Reserve", "FOMC decision tomorrow", "Rate decision in ~18 hours; markets positioning.")],
      macroEvents: [macro("FOMC rate decision", "HIGH", 18)],
      signals: calmSignals(),
    }),
    expect: { regimeAtLeast: "ELEVATED", maxSignalConfidence: 0.6 },
  },
  {
    id: "scn-geopolitics-drawdown",
    set: "scenarios",
    description: "Geopolitical escalation + price drawdown → ELEVATED/STRESSED",
    inputs: inputs({
      marketEvents: [
        news("geopolitics:Al Jazeera", "Military escalation reported", "Conflict widens; risk-off tone across assets."),
        news("crypto:CoinDesk", "ETH falls 8% on risk-off", "Broad crypto selloff amid geopolitical fears."),
      ],
      signals: [
        signal("TECHNICAL", 0.6, "ETH drawdown 8% / rising realized vol", ["T1", "T2"]),
        signal("ONCHAIN", 0.4, "Perp funding turns sharply negative", ["T3"]),
      ],
    }),
    expect: { regimeAtLeast: "ELEVATED", regimeAtMost: "CRISIS", maxSignalConfidence: 0.6 },
  },
  {
    id: "scn-usdc-depeg",
    set: "scenarios",
    description: "USDC depeg to 0.97 (on-chain confirmed) → ≥ STRESSED",
    inputs: inputs({
      marketEvents: [news("crypto:The Block", "USDC trades at 0.97", "Stablecoin discount widens on redemption fears.")],
      signals: [
        signal("ONCHAIN", 0.8, "USDC/USD at 0.97 on Chainlink + DEX pools", ["T4"]),
        signal("ORACLE", 0.5, "AaveOracle capped USDC still 1.00; proxy shows 0.97", ["T4", "T8"]),
      ],
    }),
    expect: { regimeAtLeast: "STRESSED", maxSignalConfidence: 0.6 },
  },
  {
    id: "scn-sequencer-down",
    set: "scenarios",
    description: "Arbitrum sequencer down (on-chain) → ≥ STRESSED (S6)",
    inputs: inputs({
      marketEvents: [news("crypto:CoinDesk", "Arbitrum sequencer offline", "Transactions not processing; status page confirms outage.")],
      chainNotes: ["Arbitrum One: Sequencer is currently DOWN (uptime feed answer=1); no PriceOracleSentinel."],
      signals: [signal("ORACLE", 0.9, "Sequencer uptime feed = DOWN", ["T10"])],
    }),
    expect: { regimeAtLeast: "STRESSED", maxSignalConfidence: 0.6 },
  },
  {
    id: "scn-protocol-exploit",
    set: "scenarios",
    description: "Major protocol exploit (on-chain + news) → ≥ STRESSED",
    inputs: inputs({
      marketEvents: [news("crypto:The Block", "Major lending protocol exploited for $200M", "Funds drained; team pauses markets.")],
      signals: [
        signal("ONCHAIN", 0.85, "Abnormal outflows + pause events on-chain", ["T9"]),
        signal("TECHNICAL", 0.5, "Contagion selloff across DeFi tokens", ["T1", "T3"]),
      ],
    }),
    expect: { regimeAtLeast: "STRESSED", maxSignalConfidence: 0.6 },
  },
  {
    id: "scn-negative-news-no-confirmation",
    set: "scenarios",
    description: "Negative news WITHOUT market/on-chain confirmation → max ELEVATED",
    inputs: inputs({
      marketEvents: [news("geopolitics:BBC", "Rumors of regulatory crackdown", "Unconfirmed reports; no official statement, market calm.")],
      signals: calmSignals(), // pasar/on-chain tenang → tak ada konfirmasi
    }),
    expect: { regimeAtMost: "ELEVATED", maxSignalConfidence: 0.6 },
  },
  {
    id: "scn-token-unlock",
    set: "scenarios",
    description: "Large scheduled token unlock in 12h → ≥ ELEVATED",
    inputs: inputs({
      marketEvents: [...calmNews(), news("crypto:CoinDesk", "Large unlock scheduled", "~$500M tokens unlock in ~12 hours.")],
      macroEvents: [macro("Major token unlock", "MEDIUM", 12)],
      signals: calmSignals(),
    }),
    expect: { regimeAtLeast: "ELEVATED", maxSignalConfidence: 0.6 },
  },
  {
    id: "scn-usdc-past-kink",
    set: "scenarios",
    description: "USDC util 0.95 past 0.90 kink, borrow 35%, no price move → ≥ ELEVATED (T11)",
    inputs: inputs({
      marketEvents: calmNews(),
      signals: [
        signal(
          "ONCHAIN",
          0.7,
          "USDC pool utilization 0.95 past 0.90 optimal kink; borrow APR spiked to 35%",
          ["T11"],
          0.9,
          0,
          1,
        ),
      ],
    }),
    expect: { regimeAtLeast: "ELEVATED", maxSignalConfidence: 0.6 },
  },
];

import { Eyebrow } from "@/components/ui/eyebrow";
import { AlertCircle } from "lucide-react";

const risks = [
  {
    risk: "Flash crash / MEV",
    impact: "Intra-block collapse where liquidator front-runs automated remediation",
    mitigation: "Conservative trigger buffer (e.g. HF 1.30); explicit disclaimer that extreme gaps cannot be prevented",
  },
  {
    risk: "Oracle latency",
    impact: "Heartbeat delay causes deviation between market price and on-chain valuation",
    mitigation: "Tracks native protocol oracles block-for-block; Sentinel triggers proactively before threshold",
  },
  {
    risk: "Secondary vault illiquidity",
    impact: "Layer 2 vault high utilization temporarily halts redemption",
    mitigation: "Checks redemption liquidity before firing; automatically cascades down to Layer 3 flash deleverage",
  },
  {
    risk: "Flash loan slippage",
    impact: "Extreme market illiquidity during Layer 3 collateral swap causes revert",
    mitigation: "Configurable max slippage bounds; simulation executed before broadcast",
  },
  {
    risk: "Network congestion",
    impact: "Arbitrum sequencer or gas fee surge delays keeper transaction execution",
    mitigation: "Dual-keeper architecture (Tahansoe Sentinel + Chainlink Automation fallback)",
  },
  {
    risk: "Smart contract vulnerability",
    impact: "Potential compromise of approved token allowances",
    mitigation: "Non-custodial design, strictly capped allowances, no admin keys, audited base primitives",
  },
];

export function RiskDisclosure() {
  return (
    <section id="risk" className="py-20 md:py-28 border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-start gap-4 max-w-3xl mb-12">
          <Eyebrow dot variant="danger">
            Risk & Limitations
          </Eyebrow>
          <h2 className="font-display font-light text-3xl sm:text-4xl lg:text-5xl tracking-tight text-[var(--text-primary)] leading-tight">
            What Tahansoe cannot guarantee.
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Automated defense is an active risk mitigation system, not an absolute liquidation guarantee. Clear disclosure of limitations is integral to our security model.
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-elevated)]">
                  <th className="py-3.5 px-5 font-mono uppercase tracking-wider text-[var(--text-tertiary)] font-medium w-1/4">
                    Risk Factor
                  </th>
                  <th className="py-3.5 px-5 font-mono uppercase tracking-wider text-[var(--text-tertiary)] font-medium w-3/8">
                    Potential Impact
                  </th>
                  <th className="py-3.5 px-5 font-mono uppercase tracking-wider text-[var(--text-tertiary)] font-medium w-3/8">
                    Mitigation Strategy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {risks.map((row) => (
                  <tr key={row.risk} className="hover:bg-[var(--bg-hover)] transition-colors">
                    <td className="py-3.5 px-5 font-semibold text-[var(--text-primary)] align-top">
                      {row.risk}
                    </td>
                    <td className="py-3.5 px-5 text-[var(--text-secondary)] leading-relaxed align-top">
                      {row.impact}
                    </td>
                    <td className="py-3.5 px-5 text-[var(--text-secondary)] leading-relaxed align-top">
                      {row.mitigation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-tertiary)] leading-relaxed">
          <AlertCircle className="size-4 text-[var(--warning)] shrink-0 mt-0.5" />
          <span>
            Always maintain a conservative personal Health Factor buffer. Tahansoe cannot prevent liquidations resulting from black swan oracle discontinuities or unprecedented market halts.
          </span>
        </div>
      </div>
    </section>
  );
}

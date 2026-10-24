import { ArrowUpRight } from "lucide-react";
import { Tag } from "./Tag";

interface ComparisonRow {
  aspect: string;
  typical: string;
  tahansoe: string;
  badge?: string;
  tahansoeNote?: string;
}

const ROWS: ComparisonRow[] = [
  {
    aspect: "How a position is saved",
    typical: "DeFi Saver repays by selling collateral via a swap.",
    tahansoe:
      "Uses 3 layers: wallet stablecoins (L1) → vault reserve (L2) → sell collateral only if needed (L3), keeping ETH exposure.",
  },
  {
    aspect: "Fee",
    typical: "0.05% automation fee + 0.25% swap fee (ETH→USDC) + gas charged to the position.",
    tahansoe:
      "0.15% only when we actually save you (HF below your own trigger), free otherwise; early actions by the risk agent are free; L1/L2 need no swap.",
  },
  {
    aspect: "Minimum debt",
    typical: "$500 on Arbitrum ($30k on mainnet).",
    tahansoe: "None.",
  },
  {
    aspect: "Trigger",
    typical: "Static thresholds.",
    tahansoe: "Can be raised early by the risk agent, only within your band.",
  },
  {
    aspect: "Simulation",
    typical: "Frozen prices.",
    tahansoe: "Replay real crashes and live mainnet prices on a fork.",
    badge: "Coming soon",
    tahansoeNote: "Interactive fork mode currently in testing.",
  },
];

export function Compare() {
  return (
    <section id="compare" className="py-20 md:py-28 scroll-mt-24">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center max-w-2xl mx-auto">
          <Tag>Why Tahansoe</Tag>
          <h2 className="mt-4 font-display uppercase text-[32px] sm:text-[44px] leading-[1.08] tracking-[-0.01em] text-[var(--text-primary)]">
            <span className="font-light">Tahansoe vs </span>
            <span className="font-semibold">typical automation</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--text-secondary)]">
            An honest comparison: Tahansoe vs typical automation (e.g. DeFi Saver).
          </p>
        </div>

        {/* Comparison Table for Desktop / Tablet (md+) */}
        <div className="mt-12 hidden md:block glass-surface rounded-[24px] overflow-hidden border border-[var(--border)]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)]/50">
                <th className="py-4 px-6 text-[12px] font-mono uppercase tracking-[0.06em] text-[var(--text-tertiary)] w-[22%]">
                  Parameter
                </th>
                <th className="py-4 px-6 text-[12px] font-mono uppercase tracking-[0.06em] text-[var(--text-tertiary)] w-[39%] border-l border-[var(--border)]">
                  Typical automation (e.g. DeFi Saver)
                </th>
                <th className="py-4 px-6 text-[12px] font-mono uppercase tracking-[0.06em] text-[var(--brand)] w-[39%] border-l border-[var(--border)] bg-[var(--brand-bg)]/20">
                  <div className="flex items-center justify-between">
                    <span>Tahansoe</span>
                    <span className="text-[10px] uppercase tracking-wider font-normal px-2 py-0.5 rounded-full border border-[var(--brand)]/30 bg-[var(--brand-bg)] text-[var(--brand)]">
                      3-Layer Defense
                    </span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-[14px]">
              {ROWS.map((row) => (
                <tr key={row.aspect} className="hover:bg-[var(--item-hover)]/40 transition-colors">
                  <td className="py-5 px-6 font-medium text-[var(--text-primary)] align-top">
                    {row.aspect}
                  </td>
                  <td className="py-5 px-6 leading-relaxed text-[var(--text-secondary)] align-top border-l border-[var(--border)]">
                    {row.typical}
                  </td>
                  <td className="py-5 px-6 leading-relaxed text-[var(--text-primary)] align-top border-l border-[var(--border)] bg-[var(--brand-bg)]/10">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span>{row.tahansoe}</span>
                        {row.badge && (
                          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-[var(--brand-bg)] text-[var(--brand)] border border-[var(--brand)]/25">
                            {row.badge}
                          </span>
                        )}
                      </div>
                      {row.tahansoeNote && (
                        <span className="text-[12px] text-[var(--text-tertiary)] font-mono">
                          {row.tahansoeNote}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View (< md, optimized for 390px and small viewports) */}
        <div className="mt-8 flex flex-col gap-4 md:hidden">
          {ROWS.map((row) => (
            <div
              key={row.aspect}
              className="glass-surface rounded-[20px] p-4 border border-[var(--border)] flex flex-col gap-3.5"
            >
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
                <span className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">
                  {row.aspect}
                </span>
                {row.badge && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-[var(--brand-bg)] text-[var(--brand)] border border-[var(--brand)]/25">
                    {row.badge}
                  </span>
                )}
              </div>

              {/* Tahansoe value (highlighted) */}
              <div className="rounded-[14px] p-3 bg-[var(--brand-bg)]/15 border border-[var(--brand)]/20">
                <div className="flex items-center gap-1.5 mb-1 text-[11px] font-mono uppercase tracking-wider text-[var(--brand)]">
                  <span className="size-1.5 rounded-full bg-[var(--brand)] inline-block" />
                  <span>Tahansoe</span>
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--text-primary)] font-normal">
                  {row.tahansoe}
                </p>
                {row.tahansoeNote && (
                  <p className="mt-1 text-[11px] text-[var(--text-tertiary)] font-mono">
                    {row.tahansoeNote}
                  </p>
                )}
              </div>

              {/* Typical Automation value */}
              <div className="rounded-[14px] p-3 bg-[var(--bg-subtle)]/70 border border-[var(--border)]">
                <div className="flex items-center gap-1.5 mb-1 text-[11px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  <span className="size-1.5 rounded-full bg-[var(--text-tertiary)] inline-block" />
                  <span>Typical (e.g. DeFi Saver)</span>
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  {row.typical}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footnote & Disclosures */}
        <div className="mt-8 pt-6 border-t border-[var(--border)] flex flex-col gap-3 text-[12px] text-[var(--text-tertiary)] leading-relaxed">
          <p>
            <strong className="font-semibold text-[var(--text-secondary)]">Honesty line: </strong>
            The success fee is proposed and not live yet; Tahansoe runs on testnet and is not yet audited; DeFi Saver is battle-tested.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px]">
            <span className="text-[var(--text-secondary)]">Sources (accessed Oct 2026):</span>
            <a
              href="https://help.defisaver.com/features/automation/fees"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--brand)] transition-colors underline underline-offset-2"
            >
              Automation Fees <ArrowUpRight className="size-3" />
            </a>
            <a
              href="https://help.defisaver.com/features/automation/requirements-for-using-automation"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--brand)] transition-colors underline underline-offset-2"
            >
              Requirements <ArrowUpRight className="size-3" />
            </a>
            <a
              href="https://help.defisaver.com/features/simulation-mode"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--brand)] transition-colors underline underline-offset-2"
            >
              Simulation Mode <ArrowUpRight className="size-3" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

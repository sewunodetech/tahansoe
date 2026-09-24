const risks = [
  {
    risk: "Flash crash",
    impact: "Intra-block price drop; MEV liquidator faster than agent",
    mitigation: "Conservative buffer; explicitly disclosed as unpreventable",
  },
  {
    risk: "Oracle lag",
    impact: "Deviation threshold delays detection vs. real price",
    mitigation: "Identical oracle to protocol; Pyth/RedStone as early-detection fallback",
  },
  {
    risk: "Reserve liquidity failure",
    impact: "High utilization prevents reserve withdrawal",
    mitigation: "Reserve placed in separate venue; maxWithdraw() checked before use",
  },
  {
    risk: "Flash loan revert",
    impact: "Slippage exceeds limit; transaction reverts",
    mitigation: "Simulate before execution; slippage cap; smaller retry",
  },
  {
    risk: "Gas limit breach",
    impact: "Repay + swap + flash loan exceeds performUpkeep limit",
    mitigation: "Detection and execution split into separate contracts",
  },
  {
    risk: "Smart contract bug",
    impact: "Potential fund loss",
    mitigation: "Audit; minimal module scope; kill switch",
  },
];

export function RiskDisclosure() {
  return (
    <section id="risk" className="py-20 md:py-[80px] border-t border-[#26332f]">
      <div className="max-w-[1400px] mx-auto px-6">
        {/* Header */}
        <div className="mb-12">
          <h2 className="text-4xl md:text-5xl font-display font-medium leading-[1.1] tracking-[-0.02em] text-[#fdf1e1] mb-4">
            What Tahansoe cannot do.
          </h2>
          <p className="text-[15px] leading-[1.6] text-[#c8bca9] max-w-[500px]">
            Risk automation is not a liquidation guarantee. These limitations are not in
            a footnote - they are a core part of the product.
          </p>
        </div>

        {/* Risk table */}
        <div className="border border-[#fdf1e1]/10 rounded-[24px] overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-3 gap-px bg-[#26332f]">
            <div className="bg-[#15201d] px-6 py-4">
              <span className="text-[12px] font-medium tracking-[0.08em] uppercase text-[#4ab5e0]">Risk</span>
            </div>
            <div className="bg-[#15201d] px-6 py-4">
              <span className="text-[12px] font-medium tracking-[0.08em] uppercase text-[#4ab5e0]">Impact</span>
            </div>
            <div className="bg-[#15201d] px-6 py-4">
              <span className="text-[12px] font-medium tracking-[0.08em] uppercase text-[#4ab5e0]">Mitigation</span>
            </div>
          </div>

          {/* Data rows */}
          {risks.map((row) => (
            <div
              key={row.risk}
              className="grid grid-cols-3 gap-px bg-[#26332f] border-t border-[#26332f]"
            >
              <div className="bg-[#0b1110] px-6 py-4">
                <span className="text-[13px] text-[#fdf1e1] font-medium">{row.risk}</span>
              </div>
              <div className="bg-[#0b1110] px-6 py-4">
                <span className="text-[13px] text-[#c8bca9] leading-snug">{row.impact}</span>
              </div>
              <div className="bg-[#0b1110] px-6 py-4">
                <span className="text-[13px] text-[#c8bca9] leading-snug">{row.mitigation}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Footnote */}
        <p className="mt-6 text-[12px] text-[#8f897c] max-w-[600px]">
          Tahansoe is risk automation. No system can prevent liquidation caused by an
          intra-block flash crash, oracle heartbeat delay, or gas limit breach.
          Always maintain a conservative Health Factor buffer independent of Tahansoe.
        </p>
      </div>
    </section>
  );
}

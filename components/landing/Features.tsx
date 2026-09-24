const features = [
  {
    title: "Non-custodial by design",
    body: "Your funds never move to Tahansoe. The Guardian Module can only repay debt or add collateral. Even a full compromise of Tahansoe cannot drain your wallet.",
    tag: "Security",
    wide: true,
  },
  {
    title: "Flash loan fallback",
    body: "No idle reserve needed. Tahansoe uses flash loans to remediate any position atomically, charging only ~0.05% fee.",
    tag: "Capital efficiency",
    wide: false,
  },
  {
    title: "Chainlink-identical oracles",
    body: "Tahansoe reads the same Chainlink Data Feeds as Aave V3. No divergence. No late detection.",
    tag: "Reliability",
    wide: false,
  },
  {
    title: "Aave V3 + Morpho Blue",
    body: "Unified position interface across both protocols. Aave uses a single aggregate HF; Morpho tracks each isolated market independently.",
    tag: "Multi-protocol",
    wide: false,
  },
  {
    title: "Deterministic execution, no AI in the loop",
    body: "The rule engine that fires your remediation is pure deterministic logic. LLMs are only used to translate your natural-language config into policy, always with your confirmation before commit.",
    tag: "Transparency",
    wide: false,
  },
  {
    title: "Chainlink Automation production trigger",
    body: "In production, the checkUpkeep / performUpkeep interface removes any single point of failure from the trigger layer.",
    tag: "Infrastructure",
    wide: false,
  },
];

export function Features() {
  return (
    <section id="features" className="py-20 md:py-[80px] border-t border-[#26332f]">
      <div className="max-w-[1400px] mx-auto px-6">
        {/* Header */}
        <div className="mb-14 flex flex-col md:flex-row md:items-end gap-6 md:gap-16">
          <h2 className="text-4xl md:text-5xl font-display font-medium leading-[1.1] tracking-[-0.02em] text-[#fdf1e1] max-w-[440px]">
            Built for the worst case, not the average case.
          </h2>
          <p className="text-[15px] leading-[1.6] text-[#c8bca9] max-w-[360px] md:mb-1">
            Every architectural decision in Tahansoe starts from the question: what happens when the market crashes 40% in one block?
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Wide card (spans 2 cols) */}
          <FeatureCard {...features[0]} className="md:col-span-2" />

          {/* Regular cards */}
          {features.slice(1).map((f, i, rest) => (
            <FeatureCard key={f.title} {...f} className={i === rest.length - 1 ? "md:col-span-3" : ""} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  title,
  body,
  tag,
  className = "",
}: {
  title: string;
  body: string;
  tag: string;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[24px] border border-[#fdf1e1]/10 bg-[#15201d] p-8 md:p-10 flex flex-col gap-8 hover:border-[#fdf1e1]/25 transition-colors duration-200 ${className}`}
    >
      {/* Tag */}
      <span className="self-start px-3.5 py-1.5 rounded-full border border-[#fdf1e1]/20 text-[12px] font-medium text-[#fdf1e1]/80">
        {tag}
      </span>

      <div>
        <h3 className="text-[18px] md:text-[20px] font-medium text-[#fdf1e1] tracking-[-0.015em] mb-3 leading-snug">
          {title}
        </h3>
        <p className="text-[14px] leading-[1.65] text-[#c8bca9]">{body}</p>
      </div>
    </div>
  );
}

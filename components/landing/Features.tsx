const TAG_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  Security:            { color: "#2dd4bf", bg: "rgba(45,212,191,0.08)", border: "rgba(45,212,191,0.18)" },
  "Capital efficiency":{ color: "#fbbf24", bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.18)" },
  Reliability:         { color: "#818cf8", bg: "rgba(129,140,248,0.08)", border: "rgba(129,140,248,0.18)" },
  "Multi-protocol":    { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.18)" },
  Transparency:        { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.15)" },
  Infrastructure:      { color: "#f97316", bg: "rgba(249,115,22,0.08)", border: "rgba(249,115,22,0.18)" },
};

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
    <section id="features" className="py-20 md:py-[80px] border-t border-[#27272a]">
      <div className="max-w-[1400px] mx-auto px-6">
        {/* Header */}
        <div className="mb-14 flex flex-col md:flex-row md:items-end gap-6 md:gap-16">
          <h2 className="text-4xl md:text-5xl font-medium leading-[1.1] tracking-[-0.02em] text-white max-w-[440px]">
            Built for the worst case, not the average case.
          </h2>
          <p className="text-[15px] leading-[1.6] text-[#a1a1aa] max-w-[360px] md:mb-1">
            Every architectural decision in Tahansoe starts from the question: what happens when the market crashes 40% in one block?
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[#27272a]">
          {/* Wide card (spans 2 cols) */}
          <FeatureCard {...features[0]} className="md:col-span-2" />

          {/* Regular cards */}
          {features.slice(1).map((f) => (
            <FeatureCard key={f.title} {...f} />
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
  const tagStyle = TAG_STYLES[tag] ?? { color: "#71717a", bg: "transparent", border: "transparent" };

  return (
    <div
      className={`bg-[#050505] p-8 md:p-10 flex flex-col gap-8 group hover:bg-[#18181b]/50 transition-colors duration-200 ${className}`}
    >
      {/* Tag */}
      <span
        className="font-mono text-[11px] tracking-[0.14em] uppercase self-start px-2 py-0.5 rounded-[4px]"
        style={{
          color: tagStyle.color,
          background: tagStyle.bg,
          border: `1px solid ${tagStyle.border}`,
        }}
      >
        {tag}
      </span>

      <div>
        <h3 className="text-[18px] md:text-[20px] font-medium text-white tracking-[-0.015em] mb-3 leading-snug">
          {title}
        </h3>
        <p className="text-[14px] leading-[1.65] text-[#a1a1aa]">{body}</p>
      </div>
    </div>
  );
}

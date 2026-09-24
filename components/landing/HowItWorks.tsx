const steps = [
  {
    index: "01",
    title: "Connect your position",
    body: "Link your Aave V3 or Morpho Blue position. Tahansoe reads Health Factor directly from Chainlink oracles, the same source the protocol uses.",
  },
  {
    index: "02",
    title: "Set your thresholds",
    body: "Define your trigger threshold (default 1.30) and target recovery HF (default 1.60). Tahansoe translates your intent into deterministic policy parameters.",
  },
  {
    index: "03",
    title: "Approve the Guardian Module",
    body: "A Safe Module with a strict allowlist is deployed. It can only repay debt or supply collateral. It cannot transfer funds out or approve arbitrary addresses.",
  },
  {
    index: "04",
    title: "Automated remediation",
    body: "When HF drops below your trigger, the rule engine fires: repay via flash loan or reserve, restoring your position in a single atomic transaction.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 md:py-[80px]">
      <div className="max-w-[1400px] mx-auto px-6">
        {/* Section header */}
        <div className="mb-14">
          <h2 className="text-4xl md:text-5xl font-medium leading-[1.1] tracking-[-0.02em] text-white max-w-[480px]">
            From setup to protection in four steps.
          </h2>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#27272a]">
          {steps.map((step) => (
            <StepCard key={step.index} {...step} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StepCard({
  index,
  title,
  body,
}: {
  index: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-[#050505] p-8 md:p-10 group transition-colors duration-200 hover:bg-[#18181b]/60">
      <p className="font-mono text-[11px] tracking-[0.14em] text-[#71717a] mb-6">
        {index}
      </p>
      <h3 className="text-[20px] font-medium text-white tracking-[-0.015em] mb-3 leading-snug">
        {title}
      </h3>
      <p className="text-[14px] leading-[1.65] text-[#a1a1aa] max-w-[380px]">{body}</p>
    </div>
  );
}

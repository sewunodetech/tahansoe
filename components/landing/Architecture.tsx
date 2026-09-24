const layers = [
  {
    label: "Layer 1 - Data",
    title: "Chainlink Data Feeds",
    sub: "Protocol Adapters",
    desc: "Reads positions and prices from the same oracle sources as the target protocols. No divergence risk.",
    color: "border-l-white/20",
    dotColor: "#2dd4bf",   /* teal — data ingestion */
  },
  {
    label: "Layer 2 - Policy",
    title: "Rule Engine",
    sub: "Deterministic intent",
    desc: "Evaluates Health Factor against your threshold. Outputs a structured Intent object: action, amount, asset, funding source.",
    color: "border-l-white/20",
    dotColor: "#818cf8",   /* indigo — logic/brain */
  },
  {
    label: "Layer 3 - Trigger",
    title: "checkUpkeep / performUpkeep",
    sub: "Chainlink Automation in production",
    desc: "Decentralized trigger layer. No single point of failure. During development, runs on a cron + viem loop.",
    color: "border-l-white/20",
    dotColor: "#fbbf24",   /* amber — trigger/alert */
  },
  {
    label: "Layer 4 - Execution",
    title: "Guardian Safe Module",
    sub: "Strict allowlist",
    desc: "Can only call Aave.repay(), supply(), Morpho.repay(), or whitelisted swap routers. Cannot transfer funds out.",
    color: "border-l-white/20",
    dotColor: "#34d399",   /* green — safe execution */
  },
];

export function Architecture() {
  return (
    <section className="py-20 md:py-[80px] border-t border-[#27272a]">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          {/* Left: description */}
          <div>
            <h2 className="text-4xl md:text-5xl font-medium leading-[1.1] tracking-[-0.02em] text-white mb-6">
              LLM authoring.
              <br />
              <span className="text-[#a1a1aa]">Deterministic execution.</span>
            </h2>
            <p className="text-[15px] leading-[1.6] text-[#a1a1aa] mb-8 max-w-[420px]">
              The AI never signs a transaction. It translates your intent into policy parameters. A deterministic rule engine handles everything that runs live.
            </p>
            <div className="space-y-1">
              <InvariantRow text="Compromise of Tahansoe cannot drain user funds" />
              <InvariantRow text="Worst case: attacker pays your debt for you" />
              <InvariantRow text="All executions are dry-run simulatable before going live" />
            </div>
          </div>

          {/* Right: layer stack */}
          <div className="space-y-px">
            {layers.map((layer, i) => (
              <LayerRow key={layer.label} {...layer} index={i} total={layers.length} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function LayerRow({
  label,
  title,
  sub,
  desc,
  dotColor,
  index,
  total,
}: {
  label: string;
  title: string;
  sub: string;
  desc: string;
  color: string;
  dotColor: string;
  index: number;
  total: number;
}) {
  return (
    <div className="group flex gap-6 py-6 border-t border-[#27272a] hover:bg-[#18181b]/40 px-4 -mx-4 transition-colors duration-150">
      {/* Left: connector */}
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <div className="w-px flex-1 bg-[#27272a]" />
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{
            backgroundColor: dotColor,
            boxShadow: `0 0 8px ${dotColor}88`,
          }}
        />
        {index < total - 1 && (
          <div className="w-px flex-1 bg-[#27272a]" />
        )}
      </div>

      {/* Right: content */}
      <div className="flex-1 min-w-0">
        <p
          className="font-mono text-[10px] tracking-[0.14em] uppercase mb-1"
          style={{ color: dotColor + "bb" }}
        >
          {label}
        </p>
        <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
          <h3 className="text-[15px] font-medium text-white tracking-[-0.01em]">{title}</h3>
          <span className="font-mono text-[11px] text-[#71717a]">{sub}</span>
        </div>
        <p className="text-[13px] leading-[1.6] text-[#a1a1aa]">{desc}</p>
      </div>
    </div>
  );
}

function InvariantRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        className="shrink-0 mt-0.5 text-[#a1a1aa]"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1" />
        <path
          d="M4.5 7L6.5 9L9.5 5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="text-[13px] text-[#a1a1aa] leading-snug">{text}</p>
    </div>
  );
}

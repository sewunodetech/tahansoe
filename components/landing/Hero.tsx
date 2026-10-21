/**
 * Three nested arcs = the three protection layers sitting between the
 * position (centre) and the liquidation line (bottom edge).
 */
function LayersIllustration() {
  const rings = [
    { r: 120, label: "L1" },
    { r: 190, label: "L2" },
    { r: 260, label: "L3" },
  ];
  const ticks = Array.from({ length: 37 }, (_, i) => (i * 180) / 36);

  return (
    <svg
      viewBox="-330 -330 660 400"
      className="absolute left-1/2 top-[30%] md:top-1/2 -translate-x-1/2 -translate-y-[78%] w-[560px] md:w-[640px] max-w-none opacity-90"
      aria-hidden="true"
    >
      {rings.map(({ r }, i) => (
        <g key={r}>
          <path
            d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`}
            fill="none"
            stroke="var(--brand)"
            strokeOpacity={0.55 - i * 0.12}
            strokeWidth={1}
          />
          {ticks.map((deg) => {
            const a = (deg * Math.PI) / 180;
            const x = Math.cos(a) * r;
            const y = -Math.sin(a) * r;
            return (
              <circle key={deg} cx={x} cy={y} r={1.4} fill="var(--brand)" fillOpacity={0.45 - i * 0.1} />
            );
          })}
        </g>
      ))}
      {ticks.filter((_, i) => i % 3 === 0).map((deg) => {
        const a = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={Math.cos(a) * 40}
            y1={-Math.sin(a) * 40}
            x2={Math.cos(a) * 300}
            y2={-Math.sin(a) * 300}
            stroke="var(--text-tertiary)"
            strokeOpacity={0.25}
            strokeWidth={0.75}
          />
        );
      })}
      <circle cx={0} cy={0} r={6} fill="var(--brand)" />
      <line x1={-320} y1={0} x2={320} y2={0} stroke="var(--text-tertiary)" strokeOpacity={0.4} strokeDasharray="3 5" />
    </svg>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{label}</span>
      <span className="font-display text-2xl sm:text-[28px] tracking-tight text-[var(--text-primary)] tabular-nums">
        {value}
      </span>
    </div>
  );
}

export function Hero() {
  return (
    <section className="pt-20 pb-24 md:pb-32">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="relative overflow-hidden border border-[var(--grid-line)] grid-lines min-h-[780px] md:min-h-[640px] flex flex-col justify-end">
          <LayersIllustration />

          <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-12 p-6 sm:p-10 md:p-16">
            <div className="max-w-md">
              <h1 className="font-display font-light text-[40px] sm:text-[52px] leading-[1.12] tracking-[-0.02em] text-[var(--text-primary)]">
                Three layers between your loan and liquidation
              </h1>
              <p className="mt-6 text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-sm">
                Approve your own safety net. Tahansoe repays your Aave debt before liquidators can.
              </p>
            </div>

            <div className="flex flex-col gap-6">
              <HeroStat label="Protected debt · demo" value="$12,400,000" />
              <HeroStat label="Liquidations avoided · demo" value="342" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { Tag } from "./Tag";
import { PulseScene, SentinelScene } from "./illustrations/scenes";

const agents = [
  {
    tag: "Agent 1 · Market Pulse",
    light: "One research run,",
    bold: "every subscriber",
    Scene: PulseScene,
    points: [
      { k: "What it does", v: "Reads market data (prices, lending rates, liquidity) and writes one short brief." },
      { k: "How often", v: "Once per cycle. The same brief goes out to everyone who turned it on in Telegram." },
      { k: "Never", v: "Makes up numbers or touches your position. Figures come from data, not the AI." },
    ],
  },
  {
    tag: "Agent 2 · HF Sentinel",
    light: "Watches your HF,",
    bold: "rules pull the trigger",
    Scene: SentinelScene,
    points: [
      { k: "What it does", v: "Checks your Health Factor around the clock and tells you which zone you're in." },
      { k: "When it acts", v: "Below your trigger, a fixed rule runs Layer 1 → 2 → 3. The AI explains why HF dropped." },
      { k: "Never", v: "Signs transactions or changes your settings. AI explains, rules execute." },
    ],
  },
];

export function Agents() {
  return (
    <section id="agents" className="py-20 md:py-28">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="max-w-xl">
          <Tag>Two agents</Tag>
          <h2 className="mt-4 font-display uppercase text-[32px] sm:text-[44px] leading-[1.08] tracking-[-0.01em] text-[var(--text-primary)]">
            <span className="font-light block">Two agents</span>
            <span className="font-semibold block">keeping watch</span>
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {agents.map(({ tag, light, bold, Scene, points }) => (
            <article key={tag} className="glass-surface rounded-[28px] p-6 sm:p-8 flex flex-col">
              <div className="max-w-[420px] w-full mx-auto">
                <Scene />
              </div>
              <Tag className="mt-4">{tag}</Tag>
              <h3 className="mt-3 font-display uppercase text-[24px] sm:text-[28px] leading-[1.12] text-[var(--text-primary)]">
                <span className="font-light block">{light}</span>
                <span className="font-semibold block">{bold}</span>
              </h3>
              <dl className="mt-6 flex flex-col divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {points.map(({ k, v }) => (
                  <div key={k} className="py-3 grid grid-cols-[110px_1fr] gap-4">
                    <dt className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)] pt-0.5">{k}</dt>
                    <dd className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{v}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full glass-surface px-4 h-9 text-[12px] uppercase tracking-[0.06em] text-[var(--text-secondary)]">
            <span className="size-1.5 rounded-full bg-[image:var(--iridescent)]" />
            AI explains · Rules execute · AI never signs
          </span>
        </p>
      </div>
    </section>
  );
}

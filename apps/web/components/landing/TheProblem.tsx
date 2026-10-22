import { Tag } from "./Tag";
import { PositionScene } from "./illustrations/scenes";

const facts = [
  { k: "Health Factor", v: "Collateral × liquidation threshold ÷ debt. Above 1 you're safe; below 1 you can be liquidated." },
  { k: "Liquidation", v: "Bots repay up to half your debt and take your collateral plus a ~5–10% penalty." },
  { k: "The catch", v: "Prices move at 3 a.m. too. Most liquidations happen when nobody is watching." },
];

export function TheProblem() {
  return (
    <section id="problem" className="py-20 md:py-28">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 grid grid-cols-1 md:grid-cols-2 items-center gap-10 md:gap-16">
        <div className="w-full max-w-[520px] mx-auto md:order-2">
          <PositionScene />
        </div>
        <div>
          <Tag>The problem</Tag>
          <h2 className="mt-4 font-display uppercase text-[32px] sm:text-[44px] leading-[1.08] tracking-[-0.01em] text-[var(--text-primary)]">
            <span className="font-light block">Liquidation</span>
            <span className="font-semibold block">happens while</span>
            <span className="font-light block">you sleep</span>
          </h2>
          <dl className="mt-8 flex flex-col gap-5">
            {facts.map(({ k, v }) => (
              <div key={k}>
                <dt className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[var(--text-primary)]">{k}</dt>
                <dd className="mt-1 text-[14px] leading-relaxed text-[var(--text-secondary)] max-w-md">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

import { Tag } from "./Tag";
import { CascadeScene, L1WalletScene, L2VaultScene, L3FlashScene } from "./illustrations/scenes";
import { MiniIcon, type MiniKind } from "./illustrations/MiniIcon";

type Layer = {
  id: string;
  tag: string;
  light: string;
  bold: string;
  summary: string;
  Scene: () => React.ReactElement;
  steps: { icon: MiniKind; title: string; body: string }[];
  spec: { label: string; value: string }[];
};

const layers: Layer[] = [
  {
    id: "layer-1",
    tag: "Layer 1 · Wallet reserve",
    light: "Repay from the",
    bold: "USDC in your wallet",
    summary:
      "The first and cheapest line of defence. You set aside a capped amount of the token you borrowed, and Tahansoe uses it to pay down your debt the moment your Health Factor hits your trigger.",
    Scene: L1WalletScene,
    steps: [
      { icon: "trigger", title: "HF hits your trigger", body: "Sentinel sees HF fall below the trigger you set, e.g. 1.30." },
      { icon: "pull", title: "Exact amount is pulled", body: "Only what's needed to reach your target HF, never more than your cap." },
      { icon: "repay", title: "Debt is repaid on Aave", body: "The USDC goes straight into Aave to repay your own loan." },
      { icon: "done", title: "HF back to target", body: "Leftovers return to your wallet. You get a Telegram receipt." },
    ],
    spec: [
      { label: "You approve", value: "USDC (your debt token), up to a cap you choose" },
      { label: "Runs when", value: "HF < trigger and your wallet holds USDC" },
      { label: "Cost", value: "Gas only" },
      { label: "You keep control", value: "Funds stay in your wallet until needed. Revoke anytime." },
    ],
  },
  {
    id: "layer-2",
    tag: "Layer 2 · Position reserve",
    light: "Then draw from",
    bold: "another position",
    summary:
      "If your wallet runs dry, Tahansoe redeems shares from another DeFi position you already hold, like a Morpho Vault or an Aave aToken, and uses the proceeds to repay.",
    Scene: L2VaultScene,
    steps: [
      { icon: "trigger", title: "Layer 1 isn't enough", body: "Your wallet reserve is empty or too small to reach the target." },
      { icon: "redeem", title: "Shares are redeemed", body: "Approved vault shares are withdrawn into USDC, only as much as needed." },
      { icon: "repay", title: "Debt is repaid", body: "The proceeds repay your Aave debt in the same transaction." },
      { icon: "done", title: "Rest keeps earning", body: "Shares you didn't need stay in the vault, still earning yield." },
    ],
    spec: [
      { label: "You approve", value: "Vault shares (ERC-4626) or aTokens, up to a cap" },
      { label: "Runs when", value: "HF < trigger and Layer 1 can't cover it" },
      { label: "Cost", value: "Gas, plus any vault exit fee" },
      { label: "You keep control", value: "Your position keeps earning until it's used. Revoke anytime." },
    ],
  },
  {
    id: "layer-3",
    tag: "Layer 3 · Flash deleverage",
    light: "Last resort:",
    bold: "deleverage in one step",
    summary:
      "When there's no reserve left and HF keeps falling, a flash loan repays part of your debt and just enough collateral is swapped to close it. Everything happens in a single transaction, or nothing does.",
    Scene: L3FlashScene,
    steps: [
      { icon: "flash", title: "Borrow with a flash loan", body: "USDC is borrowed for the length of one transaction." },
      { icon: "repay", title: "Repay your debt", body: "The borrowed USDC repays part of your Aave loan." },
      { icon: "swap", title: "Swap some collateral", body: "Part of your collateral is swapped to USDC, with slippage capped against the oracle." },
      { icon: "done", title: "Close the loan", body: "The flash loan is repaid. You hold less debt and a safer HF." },
    ],
    spec: [
      { label: "You approve", value: "Your collateral aToken (e.g. aWETH), up to a cap" },
      { label: "Runs when", value: "HF < trigger and Layers 1 & 2 are empty" },
      { label: "Cost", value: "~0.05% flash fee + swap slippage (max you set)" },
      { label: "You keep control", value: "Opt-in only. Atomic: if any step fails, nothing moves." },
    ],
  },
];

function LayerBlock({ layer, flip }: { layer: Layer; flip: boolean }) {
  const { Scene } = layer;
  return (
    <article id={layer.id} className="scroll-mt-24">
      <div className={`grid grid-cols-1 md:grid-cols-2 items-center gap-8 md:gap-16 ${flip ? "md:[&>*:first-child]:order-2" : ""}`}>
        <div className="w-full max-w-[520px] mx-auto">
          <Scene />
        </div>
        <div>
          <Tag>{layer.tag}</Tag>
          <h3 className="mt-4 font-display uppercase text-[28px] sm:text-[36px] leading-[1.1] tracking-[-0.01em] text-[var(--text-primary)]">
            <span className="font-light block">{layer.light}</span>
            <span className="font-semibold block">{layer.bold}</span>
          </h3>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-md">{layer.summary}</p>

          <dl className="mt-8 grid grid-cols-2 gap-px rounded-[18px] overflow-hidden border border-[var(--border)] bg-[var(--border)]">
            {layer.spec.map(({ label, value }) => (
              <div key={label} className="bg-[var(--bg-elevated)] p-4">
                <dt className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{label}</dt>
                <dd className="mt-1.5 text-[13px] leading-snug text-[var(--text-primary)]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* How it runs */}
      <ol className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {layer.steps.map((s, i) => (
          <li key={s.title} className="glass-surface rounded-[20px] p-5 flex gap-4 items-start">
            <MiniIcon kind={s.icon} className="size-14 shrink-0" />
            <div>
              <p className="text-[11px] font-mono text-[var(--text-tertiary)]">STEP {i + 1}</p>
              <p className="mt-1 text-[14px] font-medium text-[var(--text-primary)]">{s.title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

export function ProtectionLayers() {
  return (
    <section id="layers" className="py-20 md:py-28">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-[0.9fr_1.1fr] items-center gap-10">
          <div>
            <Tag>Three layers, checked in order</Tag>
            <h2 className="mt-4 font-display uppercase text-[32px] sm:text-[44px] leading-[1.08] tracking-[-0.01em] text-[var(--text-primary)]">
              <span className="font-light block">Three walls</span>
              <span className="font-semibold block">between your loan</span>
              <span className="font-light block">and liquidation</span>
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-md">
              Each layer is a permission you grant yourself, with its own cap. Tahansoe always tries the cheapest one
              first and only moves to the next if it can&apos;t restore your Health Factor.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {layers.map((l, i) => (
                <a key={l.id} href={`#${l.id}`} className="btn-ghost-soft !h-9 !px-4 !text-[12px]">
                  L{i + 1} · {l.tag.split("· ")[1]}
                </a>
              ))}
            </div>
          </div>
          <CascadeScene />
        </div>

        <div className="mt-24 md:mt-32 flex flex-col gap-24 md:gap-32">
          {layers.map((layer, i) => (
            <LayerBlock key={layer.id} layer={layer} flip={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

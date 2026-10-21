import { Tag } from "./Tag";

/* Each layer gets one simple white line drawing on a blue panel. */
function WalletShape() {
  return (
    <svg viewBox="0 0 200 200" className="relative w-1/2" aria-hidden="true">
      <circle cx="100" cy="100" r="70" fill="white" fillOpacity="0.14" stroke="white" strokeOpacity="0.8" />
      <circle cx="100" cy="100" r="46" fill="white" fillOpacity="0.12" stroke="white" strokeOpacity="0.6" />
      <circle cx="100" cy="100" r="6" fill="white" />
    </svg>
  );
}

function VaultShape() {
  return (
    <svg viewBox="0 0 200 200" className="relative w-1/2" aria-hidden="true">
      <rect x="40" y="62" width="120" height="96" rx="10" fill="white" fillOpacity="0.12" stroke="white" strokeOpacity="0.6" />
      <rect x="52" y="48" width="96" height="96" rx="10" fill="white" fillOpacity="0.14" stroke="white" strokeOpacity="0.8" />
      <circle cx="100" cy="96" r="18" fill="none" stroke="white" strokeOpacity="0.9" />
    </svg>
  );
}

function FlashShape() {
  return (
    <svg viewBox="0 0 200 200" className="relative w-1/2" aria-hidden="true">
      <path
        d="M 100 34 A 66 66 0 1 1 41 70"
        fill="none"
        stroke="white"
        strokeOpacity="0.85"
        strokeWidth="1.5"
      />
      <path d="M 30 62 L 41 70 L 46 57" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="40" fill="white" fillOpacity="0.14" stroke="white" strokeOpacity="0.6" />
    </svg>
  );
}

const layers = [
  {
    tag: "Layer 1 · Wallet reserve",
    title: "Repay from the USDC already in your wallet",
    body: "Approve a capped amount. If your Health Factor hits your trigger, Tahansoe uses it to repay your own Aave debt and nothing else.",
    Shape: WalletShape,
  },
  {
    tag: "Layer 2 · Position reserve",
    title: "Then draw from another position you hold",
    body: "If your wallet runs dry, approved vault shares, such as a Morpho Vault or an Aave aToken, are redeemed to cover the rest.",
    Shape: VaultShape,
  },
  {
    tag: "Layer 3 · Flash deleverage",
    title: "As a last resort, deleverage in one transaction",
    body: "A flash loan repays the debt, part of your collateral is swapped to close it, and the whole step happens atomically.",
    Shape: FlashShape,
  },
];

export function ProtectionLayers() {
  return (
    <section id="layers" className="pb-16 md:pb-24">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex flex-col gap-20 md:gap-32">
        {layers.map(({ tag, title, body, Shape }, i) => (
          <div
            key={tag}
            className={`grid grid-cols-1 md:grid-cols-2 items-center gap-10 md:gap-20 ${
              i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""
            }`}
          >
            <div className="brand-panel aspect-square w-full max-w-[460px] mx-auto flex items-center justify-center">
              <Shape />
            </div>
            <div className="max-w-sm mx-auto md:mx-0">
              <Tag>{tag}</Tag>
              <h2 className="mt-4 font-display text-[26px] sm:text-[28px] leading-[1.25] tracking-[-0.01em] text-[var(--text-primary)]">
                {title}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

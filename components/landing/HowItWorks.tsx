import { Eyebrow } from "@/components/ui/eyebrow";

const steps = [
  {
    index: "01",
    title: "Connect your position",
    body: "Connect your Web3 wallet. Tahansoe detects your active borrow positions on Aave V3 and reads real-time Health Factors from on-chain feeds.",
  },
  {
    index: "02",
    title: "Choose your layers",
    body: "Configure how much hot wallet USDC to allocate for Layer 1, pick an optional secondary yield vault for Layer 2, and decide if you want Layer 3 flash deleveraging enabled.",
  },
  {
    index: "03",
    title: "Approve with exact caps",
    body: "Grant explicit, capped token allowances for your chosen layers. Review what the contract can and cannot do before signing in your wallet.",
  },
  {
    index: "04",
    title: "Sentinel watches 24/7",
    body: "Sentinel monitors your Health Factor every block. If a price drop triggers your policy, remediation executes atomically to restore your target buffer.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 md:py-28 border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-start gap-4 max-w-3xl mb-14">
          <Eyebrow dot variant="brand">
            Process
          </Eyebrow>
          <h2 className="font-display font-light text-3xl sm:text-4xl lg:text-5xl tracking-tight text-[var(--text-primary)] leading-tight">
            From setup to protection in four steps.
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Non-custodial by design. You never transfer custody of your collateral to Tahansoe.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step) => (
            <div
              key={step.index}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-6 sm:p-7 flex flex-col justify-between shadow-xs transition-colors hover:border-[var(--border-strong)]"
            >
              <div>
                <span className="font-display font-light text-3xl text-[var(--brand)] block mb-4">
                  {step.index}
                </span>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2 tracking-tight">
                  {step.title}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {step.body}
                </p>
              </div>

              <div className="pt-6 mt-6 border-t border-[var(--border)] font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                Step {step.index} of 04
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

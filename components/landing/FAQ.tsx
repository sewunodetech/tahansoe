import { Eyebrow } from "@/components/ui/eyebrow";

const faqs = [
  {
    q: "What is a Health Factor?",
    a: "Health Factor (HF) is a numeric representation of your loan's collateral safety margin: (total collateral in USD × liquidation threshold) ÷ total debt in USD. An HF above 1.0 indicates a solvent position; when HF drops below 1.0, your loan is immediately eligible for liquidation.",
  },
  {
    q: "Does Tahansoe hold or take custody of my funds?",
    a: "No. Tahansoe is strictly non-custodial. You grant bounded token allowances directly to the TahansoeGuardian smart contract. The contract only pulls funds when your Health Factor drops below your configured trigger, and sends 100% of the funds into your loan repayment on Aave V3. It cannot transfer assets to any third-party address.",
  },
  {
    q: "How do the three protection layers work?",
    a: "Tahansoe executes an automated cascade: Layer 1 pulls pre-approved debt tokens (e.g. USDC) from your hot wallet. If Layer 1 is exhausted or insufficient, Layer 2 redeems shares from an approved yield vault (e.g. Morpho Vault). If both are empty and liquidation is imminent, Layer 3 initiates an atomic flash loan to deleverage your position without requiring upfront liquidity.",
  },
  {
    q: "What role do the two AI agents play?",
    a: "Agent 1 (Market Pulse) conducts daily macro research on lending rates, spreads, and volatility, and broadcasts a digest to your Telegram. Agent 2 (HF Sentinel) monitors your position on-chain every block, provides natural-language causal explanations when volatility spikes, and triggers the deterministic keeper. The AI never signs transactions or manages private keys.",
  },
  {
    q: "Can I adjust or revoke my approvals?",
    a: "Yes. You have total autonomy. You can modify your trigger and target thresholds, disable individual protection layers, or revoke your ERC-20 allowances to zero at any time directly through the dashboard or via your wallet.",
  },
  {
    q: "What are the protocol fees?",
    a: "Tahansoe charges 0% protocol fees for Layer 1 and Layer 2 remediation during the testnet phase. Layer 3 flash deleveraging incurs standard DEX swap slippage and third-party flash loan fees (~0.05%), plus network execution gas.",
  },
  {
    q: "Does Tahansoe guarantee I will never be liquidated?",
    a: "No, and we explicitly disclose this. While Tahansoe significantly reduces liquidation probability by intervening proactively at higher Health Factors (e.g., 1.30), an intra-block flash crash, severe oracle lag, or extreme chain congestion could outpace automated remediation. Always maintain a conservative buffer.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="py-20 md:py-28 border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
          <div className="lg:col-span-5 flex flex-col gap-4">
            <Eyebrow dot variant="brand">
              Frequently Asked Questions
            </Eyebrow>
            <h2 className="font-display font-light text-3xl sm:text-4xl lg:text-5xl tracking-tight text-[var(--text-primary)] leading-tight">
              Questions, answered plainly.
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Have questions regarding contract security, layer priority, or Telegram alerts? Here is how Tahansoe works under the hood.
            </p>
          </div>

          <div className="lg:col-span-7 flex flex-col divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {faqs.map(({ q, a }) => (
              <details key={q} className="group py-5">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                  <span className="text-sm sm:text-base font-medium text-[var(--text-primary)] group-hover:text-[var(--brand)] transition-colors">
                    {q}
                  </span>
                  <span
                    aria-hidden="true"
                    className="size-6 rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-center text-xs text-[var(--text-secondary)] transition-transform duration-200 group-open:rotate-45 shrink-0"
                  >
                    +
                  </span>
                </summary>
                <p className="pt-3 pr-6 text-xs sm:text-sm leading-relaxed text-[var(--text-secondary)]">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

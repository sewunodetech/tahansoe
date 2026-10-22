import { Tag } from "./Tag";

const faqs = [
  {
    q: "Does Tahansoe hold my funds?",
    a: "No. You approve capped allowances to the contract, and it can only use them to repay your own Aave debt. You can revoke them at any time.",
  },
  {
    q: "When does a layer run?",
    a: "When your Health Factor falls below the trigger you set (for example 1.30). Layer 1 runs first, then Layer 2, and Layer 3 only if the first two are not enough.",
  },
  {
    q: "Can the AI move my money?",
    a: "No. Execution follows fixed rules. The agents only explain what is happening and send you briefs on Telegram.",
  },
  {
    q: "Is liquidation impossible then?",
    a: "No. A sudden crash, oracle lag or congestion can move faster than any keeper. Tahansoe lowers the risk; it does not remove it. Not financial advice.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="py-20 md:py-28">
      <div className="max-w-[760px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <Tag>FAQ</Tag>
          <h2 className="mt-4 font-display uppercase font-light text-[28px] sm:text-[34px] tracking-[-0.01em] text-[var(--text-primary)]">
            Questions
          </h2>
        </div>

        <div className="mt-10 border-t border-[var(--border)]">
          {faqs.map(({ q, a }) => (
            <details key={q} className="group border-b border-[var(--border)] py-5">
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="text-[15px] text-[var(--text-primary)]">{q}</span>
                <span
                  aria-hidden="true"
                  className="text-lg leading-none text-[var(--text-tertiary)] transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pt-3 pr-8 text-sm leading-relaxed text-[var(--text-secondary)]">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

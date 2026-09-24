const faqs = [
  {
    q: "What is a Health Factor?",
    a: "A single number that says how safe your loan is: (collateral value × liquidation threshold) ÷ debt. Above 1.0 you're fine; at or below 1.0 your position can be liquidated. The further above 1.0, the bigger your buffer against price drops.",
  },
  {
    q: "Does Tahansoe hold my funds?",
    a: "No. Tahansoe is non-custodial. You approve a Guardian Safe Module with a strict allowlist: it can only repay debt or supply collateral on Aave V3 and Morpho Blue. It cannot transfer funds out or approve arbitrary addresses. Even if Tahansoe were fully compromised, the worst an attacker could do is pay your debt for you.",
  },
  {
    q: "What exactly happens when my HF hits the trigger?",
    a: "The rule engine picks the first available strategy in priority order: repay from your hot reserve, repay with a flash loan, or deleverage by swapping part of your collateral. It repays just enough to bring you back to your target HF (1.60 by default), simulates the transaction first, and executes it atomically. You get a Telegram notification at each step.",
  },
  {
    q: "Can I change the trigger and target?",
    a: "Yes. The defaults are trigger 1.30 and target 1.60, and you can set your own in the dashboard settings, along with which strategies Tahansoe is allowed to use. If you disable every strategy, Tahansoe still alerts you but won't act.",
  },
  {
    q: "Is an AI making decisions with my money?",
    a: "No. An LLM only helps translate what you type in plain language into policy parameters, and you always confirm before anything is saved. The engine that actually fires remediation is pure deterministic logic. The AI never signs a transaction.",
  },
  {
    q: "Which protocols are supported?",
    a: "Aave V3 and Morpho Blue. Aave uses one aggregate Health Factor per account, while Morpho tracks each isolated market separately. Tahansoe handles both through one interface.",
  },
  {
    q: "What does it cost?",
    a: "When a flash loan is used, the provider charges roughly 0.05% of the borrowed amount, plus normal gas. Pricing for Tahansoe itself hasn't been set yet; the product is still in pre-development on testnet.",
  },
  {
    q: "Does this guarantee I'll never be liquidated?",
    a: "No, and we won't pretend otherwise. Tahansoe greatly reduces the chance by acting early, but an intra-block flash crash, oracle heartbeat delay, or gas spike can still beat any automation. Keep a conservative buffer. See the risk disclosure below for the full list.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="py-20 md:py-[80px] border-t border-[#26332f]">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-12 lg:gap-16">
          <div>
            <p className="text-[12px] font-medium tracking-[0.08em] uppercase text-[#4ab5e0] mb-5">FAQ</p>
            <h2 className="text-4xl md:text-5xl font-display font-medium leading-[1.1] tracking-[-0.02em] text-[#fdf1e1]">
              Questions, answered plainly.
            </h2>
          </div>
          <div className="border-t border-[#26332f]">
            {faqs.map(({ q, a }) => (
              <details key={q} className="group border-b border-[#26332f]">
                <summary className="flex items-center justify-between gap-6 py-5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span className="text-[16px] md:text-[17px] font-medium text-[#fdf1e1] tracking-[-0.01em]">{q}</span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 w-7 h-7 rounded-full border border-[#fdf1e1]/20 flex items-center justify-center text-[#c8bca9] transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="pb-6 pr-12 text-[14px] leading-[1.7] text-[#c8bca9] max-w-[680px]">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

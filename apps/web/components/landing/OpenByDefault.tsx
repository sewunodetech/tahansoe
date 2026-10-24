import { ArrowUpRight } from "lucide-react";
import { Tag } from "./Tag";
import { AnnotatedCode, type CodeLine } from "./AnnotatedCode";

const CONTRACT_ADDRESS = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";
const ARBISCAN_URL = `https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}`;

const CODE_LINES: CodeLine[] = [
  { code: "function protect(address user) external nonReentrant {", note: "Anyone can call this: you, a keeper bot, or Tahansoe. It can only ever help the user named here." },
  { code: "    Policy memory policy = policies[user];", note: "Loads the trigger, target, and caps that you set yourself." },
  { code: "    uint256 hf = healthFactor(user);", note: "Reads your Health Factor straight from Aave, the same oracle Aave uses for liquidations." },
  { code: '    require(hf < policy.triggerHf, "HF above trigger");', note: "Does nothing unless your HF is below the trigger you chose." },
  { code: "" },
  { code: "    uint256 amount = quoteRepay(user, policy.targetHf);", note: "Works out just enough to bring HF back to your target, not a cent more." },
  { code: "    if (amount > policy.maxRepayCap) amount = policy.maxRepayCap;", note: "Never more than the cap you approved, even if more would help." },
  { code: "" },
  { code: "    debt.transferFrom(user, address(this), amount);", note: "Pulls USDC from your wallet, and only up to the allowance you granted." },
  { code: "    AAVE_POOL.repay(address(debt), amount, 2, user);", note: "Repays your own Aave debt in the same transaction. The funds have nowhere else to go." },
  { code: '    require(healthFactor(user) > hf, "HF did not improve");', note: "Safety check: if your HF didn't get better, everything is reverted." },
  { code: "}" },
];

const facts = [
  { title: "Non-custodial", body: "Funds only ever repay your own debt.", href: ARBISCAN_URL, cta: "View contract" },
  { title: "Revoke anytime", body: "Set any approval back to zero in one click.", href: "/dashboard/protection", cta: "Manage" },
  { title: "Not a guarantee", body: "A flash crash can still outrun a keeper.", href: "#faq", cta: "Read more" },
];

export function OpenByDefault() {
  return (
    <section id="contract" className="py-20 md:py-28">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-center text-center">
          <Tag>Contract</Tag>
          <h2 className="mt-4 font-display uppercase font-light text-[28px] sm:text-[34px] tracking-[-0.01em] text-[var(--text-primary)]">
            Open by default
          </h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Anyone can read the rules. Anyone can call <code className="font-mono text-[13px]">protect()</code>.
          </p>
        </div>

        <div className="mt-10 max-w-[1000px] mx-auto glass-surface rounded-[24px] overflow-hidden">
          <div className="flex items-center justify-between h-10 px-4 border-b border-[var(--border)]">
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">TahansoeGuardian.sol</span>
            <a
              href={ARBISCAN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--text-tertiary)] hover:text-[var(--brand)]"
            >
              Arbiscan <ArrowUpRight className="size-3" />
            </a>
          </div>
          <AnnotatedCode lines={CODE_LINES} />
        </div>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-10 max-w-[900px] mx-auto text-center">
          {facts.map(({ title, body, href, cta }) => (
            <div key={title}>
              <p className="text-[15px] text-[var(--text-primary)]">{title}</p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{body}</p>
              <a
                href={href}
                {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="mt-3 inline-flex items-center gap-1 text-[13px] text-[var(--brand)]"
              >
                {cta} <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

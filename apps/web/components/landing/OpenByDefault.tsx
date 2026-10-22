import { ArrowUpRight } from "lucide-react";
import { Tag } from "./Tag";

const CONTRACT_ADDRESS = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";
const ARBISCAN_URL = `https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}`;

const CODE_LINES = [
  "function protect(address user) external nonReentrant {",
  "    Policy memory policy = policies[user];",
  "    uint256 hf = healthFactor(user);",
  '    require(hf < policy.triggerHf, "HF above trigger");',
  "",
  "    uint256 amount = quoteRepay(user, policy.targetHf);",
  "    if (amount > policy.maxRepayCap) amount = policy.maxRepayCap;",
  "",
  "    debt.transferFrom(user, address(this), amount);",
  "    AAVE_POOL.repay(address(debt), amount, 2, user);",
  '    require(healthFactor(user) > hf, "HF did not improve");',
  "}",
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

        <div className="mt-10 max-w-[760px] mx-auto glass-surface rounded-[24px] overflow-hidden">
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
          <pre className="p-4 sm:p-5 overflow-x-auto font-mono text-[12px] leading-[1.7]">
            {CODE_LINES.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-8 shrink-0 select-none text-[var(--text-placeholder)]">{i + 1}</span>
                <span className="text-[var(--text-secondary)] whitespace-pre">{line}</span>
              </div>
            ))}
          </pre>
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

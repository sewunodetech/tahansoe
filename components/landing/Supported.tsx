import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight } from "lucide-react";

type ProtocolItem = {
  name: string;
  category: string;
  status: "Live" | "Coming Soon";
  description: string;
  badgeVariant: "safe" | "secondary";
  linkText: string;
  linkHref: string;
};

const PROTOCOLS: ProtocolItem[] = [
  {
    name: "Aave V3",
    category: "Lending Market",
    status: "Live",
    description: "Full Health Factor tracking and automated repayment across ETH, WBTC, and USDC pools on Arbitrum Sepolia.",
    badgeVariant: "safe",
    linkText: "View Markets",
    linkHref: "https://aave.com",
  },
  {
    name: "Arbitrum One / Sepolia",
    category: "Execution Layer",
    status: "Live",
    description: "Sub-second block confirmation times and negligible gas overhead enable fast, cost-effective liquidation defense.",
    badgeVariant: "safe",
    linkText: "Arbiscan",
    linkHref: "https://sepolia.arbiscan.io/address/0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E",
  },
  {
    name: "Morpho Blue",
    category: "Isolated Markets & Flash Loans",
    status: "Coming Soon",
    description: "Protection for permissionless lending pairs and 0% fee flash loans for hyper-efficient Layer 3 deleveraging.",
    badgeVariant: "secondary",
    linkText: "morpho.org",
    linkHref: "https://morpho.org",
  },
  {
    name: "Chainlink",
    category: "Oracle & Automation",
    status: "Live",
    description: "Price reference feeds and decentralized Automation infrastructure acting as secondary keeper execution backup.",
    badgeVariant: "safe",
    linkText: "chain.link",
    linkHref: "https://chain.link",
  },
];

export function Supported() {
  return (
    <section className="py-20 md:py-28 border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-start gap-4 max-w-3xl mb-14">
          <Eyebrow dot variant="brand">
            Integrations
          </Eyebrow>
          <h2 className="font-display font-light text-3xl sm:text-4xl lg:text-5xl tracking-tight text-[var(--text-primary)] leading-tight">
            Supported protocols & networks.
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Tahansoe integrates directly with audited lending protocols and high-throughput execution layers to protect your borrow positions.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {PROTOCOLS.map((item) => (
            <div
              key={item.name}
              className="rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-6 flex flex-col justify-between shadow-xs transition-colors hover:border-[var(--border-strong)]"
            >
              <div>
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border)]">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    {item.category}
                  </span>
                  <Badge variant={item.badgeVariant} dot size="sm">
                    {item.status}
                  </Badge>
                </div>

                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2 tracking-tight">
                  {item.name}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-6">
                  {item.description}
                </p>
              </div>

              <div className="pt-4 border-t border-[var(--border)]">
                <a
                  href={item.linkHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline"
                >
                  <span>{item.linkText}</span>
                  <ArrowUpRight className="size-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

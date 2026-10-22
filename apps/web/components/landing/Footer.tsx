import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { telegramBotUrl } from "@/lib/telegram";

const CONTRACT_ADDRESS = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";
const ARBISCAN_URL = `https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}`;

const links = [
  { href: "#layers", label: "Layers" },
  { href: "#agents", label: "Agents" },
  { href: "#faq", label: "FAQ" },
  { href: telegramBotUrl, label: "Telegram", external: true },
  { href: ARBISCAN_URL, label: "Contract", external: true },
];

export function Footer() {
  return (
    <footer className="pt-20 pb-10">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 pb-16">
          <p className="font-display text-[26px] leading-[1.25] tracking-[-0.01em] text-[var(--text-primary)]">
            Stay in the loop.
            <br />
            Get alerts on Telegram.
          </p>
          <div className="flex items-center gap-2">
            <a
              href={telegramBotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center h-10 px-5 rounded-full border border-[var(--border-strong)] text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
            >
              Join on Telegram
            </a>
            <Link
              href="/dashboard"
              className="inline-flex items-center h-10 px-5 rounded-full bg-[var(--brand)] text-white hover:bg-[var(--color-brand-400)] text-[13px] transition-colors"
            >
              Launch app
            </Link>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pt-8 border-t border-[var(--border)]">
          <div className="flex items-center gap-2">
            <BrandMark size={18} />
            <span className="text-[13px] text-[var(--text-secondary)]">Liquidation protection on Arbitrum · Testnet</span>
          </div>
          <nav className="flex flex-wrap gap-5 text-[13px] text-[var(--text-secondary)]">
            {links.map(({ href, label, external }) => (
              <a
                key={label}
                href={href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="hover:text-[var(--text-primary)] transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

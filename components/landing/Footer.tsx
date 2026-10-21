import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { ExternalLink, Send } from "lucide-react";
import { TELEGRAM_BOT_USERNAME } from "@/lib/telegram";

const CONTRACT_ADDRESS = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";
const ARBISCAN_URL = `https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}`;

export function Footer() {
  const telegramBot = TELEGRAM_BOT_USERNAME;

  return (
    <footer className="py-12 bg-[var(--bg)] border-t border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8 pb-10 border-b border-[var(--border)]">
          <div className="flex flex-col items-start gap-3">
            <Link href="/" className="flex items-center gap-2.5">
              <BrandMark size={28} />
              <span className="font-display font-medium text-lg tracking-tight text-[var(--text-primary)]">
                Tahansoe
              </span>
            </Link>
            <p className="text-xs text-[var(--text-tertiary)] max-w-sm leading-relaxed">
              Autonomous liquidation defense for DeFi borrowers. Self-approved 3-layer protection cascade with dual AI advisory agents.
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-6 text-xs text-[var(--text-secondary)]">
            <a href="#layers" className="hover:text-[var(--text-primary)] transition-colors">
              Layers
            </a>
            <a href="#agents" className="hover:text-[var(--text-primary)] transition-colors">
              Agents
            </a>
            <a href="#how-it-works" className="hover:text-[var(--text-primary)] transition-colors">
              How it works
            </a>
            <a href="#faq" className="hover:text-[var(--text-primary)] transition-colors">
              FAQ
            </a>
            <a href="#risk" className="hover:text-[var(--text-primary)] transition-colors">
              Risks
            </a>
            <a
              href={`https://t.me/${telegramBot}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
            >
              <Send className="size-3 text-[var(--brand)]" />
              <span>Telegram</span>
            </a>
            <a
              href={ARBISCAN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
            >
              <span>Contract</span>
              <ExternalLink className="size-3" />
            </a>
          </nav>
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[var(--text-tertiary)] font-mono">
          <p>© {new Date().getFullYear()} Tahansoe · Arbitrum Sepolia Testnet</p>
          <p className="max-w-md text-left sm:text-right leading-relaxed">
            Non-custodial risk automation. Smart contract audit pending. Not financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
}

import Link from "next/link";
import { ArrowUpRight, Send, Shield } from "lucide-react";
import { TELEGRAM_BOT_USERNAME } from "@/lib/telegram";

export function CTA() {
  const telegramBot = TELEGRAM_BOT_USERNAME;

  return (
    <section className="py-20 md:py-28 border-b border-[var(--border)] relative overflow-hidden">
      <div
        className="absolute inset-0 grid-lines opacity-30 pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-radial from-[var(--color-brand-midnight)]/10 via-transparent to-transparent pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg-subtle)] p-8 sm:p-12 md:p-16 flex flex-col items-center text-center max-w-4xl mx-auto shadow-sm">
          <div className="size-12 rounded-2xl bg-[var(--brand-bg)] border border-[var(--brand-border)] flex items-center justify-center text-[var(--brand)] mb-6">
            <Shield className="size-6" />
          </div>

          <h2 className="font-display font-light text-3xl sm:text-4xl md:text-5xl tracking-tight text-[var(--text-primary)] leading-tight mb-4">
            Protect your loan before volatility strikes.
          </h2>

          <p className="text-sm sm:text-base text-[var(--text-secondary)] max-w-xl leading-relaxed mb-8">
            Connect your wallet to configure automated 3-layer protection for your Aave V3 borrow positions on Arbitrum Sepolia.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[var(--brand)] text-white hover:bg-[var(--color-brand-400)] active:bg-[var(--color-brand-midnight)] text-sm font-medium transition-all shadow-xs"
            >
              <span>Launch app</span>
              <ArrowUpRight className="size-4" />
            </Link>

            <a
              href={`https://t.me/${telegramBot}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-11 px-5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-sm font-medium transition-all"
            >
              <Send className="size-4 text-[var(--brand)]" />
              <span>Join on Telegram</span>
            </a>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-[var(--text-tertiary)] font-mono">
            <span>Non-custodial</span>
            <span>•</span>
            <span>No lockups</span>
            <span>•</span>
            <span>Arbitrum Sepolia Live</span>
          </div>
        </div>
      </div>
    </section>
  );
}

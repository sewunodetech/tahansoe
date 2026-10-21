import Link from "next/link";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Stat } from "@/components/ui/stat";
import { ArrowUpRight, Send, ShieldCheck, Zap } from "lucide-react";
import { TELEGRAM_BOT_USERNAME } from "@/lib/telegram";

export function Hero() {
  const telegramBot = TELEGRAM_BOT_USERNAME;

  return (
    <section className="relative min-h-[90dvh] flex flex-col justify-center overflow-hidden pt-24 pb-16 md:pt-32 md:pb-24 border-b border-[var(--border)]">
      <div
        className="absolute inset-0 grid-lines opacity-40 pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-radial from-[var(--color-brand-midnight)]/15 via-transparent to-transparent pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-[var(--bg)] to-transparent pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          <div className="lg:col-span-7 flex flex-col items-start gap-6">
            <Eyebrow dot variant="brand">
              Autonomous Liquidation Defense · Arbitrum Sepolia
            </Eyebrow>

            <h1 className="font-display font-light text-4xl sm:text-5xl lg:text-6xl tracking-tight text-[var(--text-primary)] leading-[1.12]">
              Three layers between your loan and liquidation.
            </h1>

            <p className="text-base sm:text-lg text-[var(--text-secondary)] max-w-2xl leading-relaxed">
              Tahansoe watches your Health Factor 24/7 and triggers self-approved repayments from wallet reserves, vault shares, or flash loans before liquidators can seize your collateral.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
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
                className="inline-flex items-center gap-2 h-11 px-5 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-sm font-medium transition-all"
              >
                <Send className="size-4 text-[var(--brand)]" />
                <span>Join on Telegram</span>
              </a>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] pt-2 font-mono">
              <ShieldCheck className="size-4 text-[var(--safe)] shrink-0" />
              <span>Non-custodial smart contracts · You approve every layer · Revoke anytime</span>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)]/80 backdrop-blur-md p-6 sm:p-8 flex flex-col gap-6 shadow-sm">
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                  Protocol Metrics
                </span>
                <span className="font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--brand)] border border-[var(--border)]">
                  Testnet / Demo
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-6">
                <div className="flex items-center justify-between">
                  <Stat
                    label="Protected Debt"
                    value="$12.4M"
                    sub="Cumulative collateral protected"
                    size="md"
                  />
                  <div className="size-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--brand)] shrink-0">
                    <ShieldCheck className="size-4" />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 lg:pt-0 border-t sm:border-t-0 lg:border-t border-[var(--border)]">
                  <Stat
                    label="Positions Guarded"
                    value="1,420"
                    sub="Active loan policies"
                    size="md"
                  />
                  <div className="size-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--safe)] shrink-0">
                    <Zap className="size-4" />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 lg:pt-0 border-t sm:border-t-0 lg:border-t border-[var(--border)]">
                  <Stat
                    label="Liquidations Avoided"
                    value="342"
                    sub="Automated repay executions"
                    size="md"
                  />
                  <div className="size-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center text-[var(--warning)] shrink-0">
                    <ArrowUpRight className="size-4" />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-[var(--border)]">
                <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
                  Automated risk defense — not a 100% guarantee against extreme volatility or network congestion.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

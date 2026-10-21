import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
import { Send, Activity, ShieldCheck, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";

export function Agents() {
  const telegramBot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "cuustos_bot";

  return (
    <section id="agents" className="py-20 md:py-28 border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-start gap-4 max-w-3xl mb-14">
          <Eyebrow dot variant="brand">
            Dual AI Architecture
          </Eyebrow>
          <h2 className="font-display font-light text-3xl sm:text-4xl lg:text-5xl tracking-tight text-[var(--text-primary)] leading-tight">
            Two specialized AI agents. Deterministic safety.
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            AI models research market conditions and explain position telemetry. Smart contracts enforce rigid mathematical rules — AI never signs transactions or manages private keys.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-6 sm:p-8 flex flex-col justify-between shadow-xs">
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-[var(--brand-bg)] border border-[var(--brand-border)] flex items-center justify-center text-[var(--brand)]">
                    <Send className="size-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-[var(--text-primary)]">
                      Agent 1 · Market Pulse
                    </h3>
                    <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                      Macro & Liquidity Research
                    </span>
                  </div>
                </div>
                <Badge variant="brand">Broadcast Agent</Badge>
              </div>

              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Conducts a single aggregated research run each cycle across Arbitrum Aave V3 and Morpho markets, analyzes rate momentum via LLM, and broadcasts one concise intelligence brief to all Telegram subscribers.
              </p>

              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] font-mono text-xs flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border)] text-[11px] text-[var(--text-tertiary)]">
                  <span>Tahansoe Bot (@{telegramBot})</span>
                  <span>Today · 08:00 UTC</span>
                </div>
                <div className="space-y-2 text-[var(--text-primary)] leading-relaxed">
                  <p className="font-medium text-[var(--brand)]">
                    [Daily Pulse: Arbitrum Lending Markets]
                  </p>
                  <p className="text-[var(--text-secondary)]">
                    • Aave V3 USDC borrow APR surged +1.4% to 5.8% following large perpetual arbitrage flows.
                  </p>
                  <p className="text-[var(--text-secondary)]">
                    • ETH 24h realized volatility: 34.2%. Primary support band $2,950-$3,050.
                  </p>
                  <p className="text-[var(--safe)]">
                    • Sentinel Advisory: Recommended buffer HF ≥ 1.40. All 1,420 guarded policies currently in Safe zone.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-[var(--border)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-[var(--text-tertiary)] font-mono">
                <CheckCircle2 className="size-4 text-[var(--safe)]" />
                <span>1 cycle research run → Broadcast fanout</span>
              </div>
              <a
                href={`https://t.me/${telegramBot}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline font-medium"
              >
                <span>Subscribe</span>
                <ArrowRight className="size-3.5" />
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-6 sm:p-8 flex flex-col justify-between shadow-xs">
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-lg bg-[var(--safe-bg)] border border-[var(--safe-border)] flex items-center justify-center text-[var(--safe)]">
                    <Activity className="size-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-[var(--text-primary)]">
                      Agent 2 · HF Sentinel
                    </h3>
                    <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                      Real-Time Keeper & Advisor
                    </span>
                  </div>
                </div>
                <Badge variant="safe">Rule Keeper</Badge>
              </div>

              <div className="inline-flex items-center gap-2 p-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-secondary)]">
                <ShieldCheck className="size-4 text-[var(--safe)] shrink-0" />
                <span className="font-medium text-[var(--text-primary)]">
                  AI explains, rules execute — AI never signs transactions.
                </span>
              </div>

              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Monitors every block on-chain. When Health Factor approaches risk thresholds, Sentinel classifies risk zones and triggers on-chain remediation through immutable smart contract rules.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <div className="size-2 rounded-full bg-[var(--safe)] mt-1.5 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold text-[var(--text-primary)]">Safe Zone (HF &gt; 1.50):</span>
                    <span className="text-[var(--text-secondary)] ml-1">Continuous silent oracle polling. Zero noise.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <div className="size-2 rounded-full bg-[var(--warning)] mt-1.5 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold text-[var(--text-primary)]">Watch Zone (1.30 &lt; HF ≤ 1.50):</span>
                    <span className="text-[var(--text-secondary)] ml-1">Telegram early warning dispatch with AI volatility explanation.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <div className="size-2 rounded-full bg-[var(--danger)] mt-1.5 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold text-[var(--text-primary)]">Warning / Action (HF ≤ 1.30):</span>
                    <span className="text-[var(--text-secondary)] ml-1">Keeper executes atomic L1 → L2 → L3 cascade to restore target 1.60.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-6 mt-6 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--text-tertiary)] font-mono">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-[var(--warning)]" />
                <span>Deterministic Keeper + Chainlink Automation fallback</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

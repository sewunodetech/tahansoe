"use client";

import { PageHeader } from "@/components/dashboard/page-header";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck,
  AlertTriangle,
  TrendingDown,
  ArrowRight,
  Bot,
  Newspaper,
  CheckCircle2,
  Clock,
  SlidersHorizontal,
} from "lucide-react";
import { useProtection } from "@/hooks/useProtection";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { LayerBadge } from "@/components/ui/layer-badge";
import { ZoneBar } from "@/components/ui/zone-bar";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { SimDashboard } from "@/components/dashboard/sim/sim-dashboard";
import { LivePage } from "@/components/dashboard/live/live-page";
import { GuardianView } from "@/components/dashboard/guardian-view/guardian-view";

function DemoDashboardPage() {
  const router = useRouter();
  const {
    position,
    hf,
    zone,
    layers,
    policy,
    activity,
    actions,
    ethPrice,
    hasPolicy,
  } = useProtection();

  // Auto-redirect to setup wizard when no policy exists
  useEffect(() => {
    if (!hasPolicy) {
      router.replace("/dashboard/protection/setup");
    }
  }, [hasPolicy, router]);

  const debtUsd = position?.debtUsd ?? 5400;
  const collateralUsd = position?.collateralUsd ?? 14280;

  // Plain language trigger math
  const triggerEthPrice = Math.max(0, Math.round((ethPrice.price * policy.triggerHF) / hf));
  const dropPct = ethPrice.price > 0 ? Math.max(0, Math.round(((ethPrice.price - triggerEthPrice) / ethPrice.price) * 100)) : 0;
  const liquidationPrice = Math.round(debtUsd / (4.2 * 0.825));

  const activeLayersCount = [layers.l1.enabled, layers.l2.enabled, layers.l3.enabled].filter(Boolean).length;
  const recentExecutions = activity.filter((h) => h.action !== "NOOP").slice(0, 4);

  // If redirecting, show a clean loading/entry state
  if (!hasPolicy) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-lg bg-[var(--brand-bg)] border border-[var(--border)] flex items-center justify-center">
          <ShieldCheck className="w-6 h-6 text-[var(--brand)] animate-pulse" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-light font-display text-[var(--text-primary)]">
            No Protection Policy Configured
          </h2>
          <p className="text-xs text-[var(--text-tertiary)] max-w-sm">
            Redirecting to the Protection Setup Wizard to configure automated defense…
          </p>
        </div>
        <Button variant="primary" size="md" asChild>
          <Link href="/dashboard/protection/setup">
            Open Setup Wizard <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full p-5 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Position health and protection"
        actions={
          <>
            <Button variant="outline" size="sm" asChild className="text-xs">
              <Link href="/dashboard/protection">
                <SlidersHorizontal className="size-3.5" /> Manage
              </Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => actions.simulatePriceDrop(15)} className="text-xs">
              <TrendingDown className="size-3.5 text-[var(--warning)]" /> Simulate a 15% drop
            </Button>
          </>
        }
      />

      {/* ── Warning Banner (if at risk) ───────────────────────────────────────── */}
      {zone !== "Safe" && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--warning-bg)] border border-[var(--warning-border)] text-xs text-[var(--warning)]">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 animate-pulse" />
            <span>
              Health Factor is {hf.toFixed(2)} ({zone}). Tahansoe Sentinel is actively monitoring for trigger conditions.
            </span>
          </div>
          <Button variant="outline" size="sm" asChild className="text-[11px] h-7 font-mono">
            <Link href="/dashboard/protection">Inspect Defense</Link>
          </Button>
        </div>
      )}

      {/* ── 1. Large Status Card (HF, Zone Pill, ZoneBar, Markers) ─────────────── */}
      <Card className="p-5 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-medium text-[var(--text-primary)]">
                {position?.protocol ?? "Aave V3"} Position
              </span>
              <span className="text-xs font-mono text-[var(--text-tertiary)]">
                Arbitrum · Collateral {position?.collateral ?? "4.2 ETH"} (${collateralUsd.toLocaleString("en-US")}) · Debt {position?.debt ?? "5,400 USDC"}
              </span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-1 font-mono">
              Liquidation threshold: 0.825 · Oracle: Chainlink ETH/USD (${ethPrice.price.toLocaleString("en-US")})
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
                Health Factor
              </span>
              <span className="text-3xl font-light font-mono text-[var(--text-primary)]">
                {hf.toFixed(2)}
              </span>
            </div>
            <StatusPill zone={zone} size="md" />
          </div>
        </div>

        {/* Zone Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-[var(--text-tertiary)]">
            <span>Risk Scale</span>
            <span className="text-[var(--text-secondary)]">
              Trigger: {policy.triggerHF.toFixed(2)} · Target: {policy.targetHF.toFixed(2)}
            </span>
          </div>
          <ZoneBar hf={hf} trigger={policy.triggerHF} target={policy.targetHF} />
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Current ETH Spot
            </span>
            <span className="text-sm font-mono font-medium text-[var(--text-primary)] mt-0.5 block">
              ${ethPrice.price.toLocaleString("en-US")}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Action Trigger Price
            </span>
            <span className="text-sm font-mono font-medium text-[var(--warning)] mt-0.5 block">
              ${triggerEthPrice.toLocaleString("en-US")} (-{dropPct}%)
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Aave Liq Price
            </span>
            <span className="text-sm font-mono font-medium text-[var(--danger)] mt-0.5 block">
              ${liquidationPrice.toLocaleString("en-US")}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">
              Active Defense
            </span>
            <span className="text-sm font-mono font-medium text-[var(--safe)] mt-0.5 block">
              {activeLayersCount} / 3 Layers Ready
            </span>
          </div>
        </div>
      </Card>

      {/* ── 2. "What happens next" Panel ──────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 className="text-sm font-medium text-[var(--text-primary)]">
              What Happens Next
            </h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
              Automated defensive execution plan in plain language if market conditions deteriorate.
            </p>
          </div>
          <Badge variant={activeLayersCount > 0 ? "safe" : "danger"} size="sm">
            {activeLayersCount === 3
              ? "Full 3-Layer Defense Active"
              : activeLayersCount > 0
              ? `${activeLayersCount} Layer Active`
              : "Unprotected"}
          </Badge>
        </div>

        <div className="space-y-3">
          {/* Layer 1 Cascade */}
          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <LayerBadge layer={1} />
              <div>
                <p className="text-xs text-[var(--text-primary)] leading-snug">
                  {layers.l1.enabled && layers.l1.approved ? (
                    <>
                      If ETH falls to <strong className="font-mono text-[var(--warning)]">${triggerEthPrice.toLocaleString("en-US")}</strong> (-{dropPct}%) → <strong className="text-[var(--text-primary)]">Layer 1</strong> repays up to <strong className="font-mono">{layers.l1.capacity.toLocaleString("en-US")} USDC</strong> from your wallet.
                    </>
                  ) : (
                    <span className="text-[var(--text-tertiary)]">
                      Layer 1 (Wallet Reserve): not set up, or the allowance was revoked.
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {layers.l1.enabled && layers.l1.approved ? (
                <span className="text-xs font-mono text-[var(--safe)] font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                </span>
              ) : (
                <Link
                  href="/dashboard/protection"
                  className="text-xs font-mono text-[var(--brand)] hover:underline"
                >
                  Set up →
                </Link>
              )}
            </div>
          </div>

          {/* Layer 2 Cascade */}
          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <LayerBadge layer={2} />
              <div>
                <p className="text-xs text-[var(--text-primary)] leading-snug">
                  {layers.l2.enabled && layers.l2.approved ? (
                    <>
                      If Layer 1 is depleted or insufficient → <strong className="text-[var(--text-primary)]">Layer 2</strong> redeems up to <strong className="font-mono">${layers.l2.capacity.toLocaleString("en-US")}</strong> from secondary vault shares.
                    </>
                  ) : (
                    <span className="text-[var(--text-tertiary)]">
                      Layer 2 (Position Reserve): not set up or disabled.
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {layers.l2.enabled && layers.l2.approved ? (
                <span className="text-xs font-mono text-[var(--safe)] font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                </span>
              ) : (
                <Link
                  href="/dashboard/protection"
                  className="text-xs font-mono text-[var(--brand)] hover:underline"
                >
                  Set up →
                </Link>
              )}
            </div>
          </div>

          {/* Layer 3 Cascade */}
          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <LayerBadge layer={3} />
              <div>
                <p className="text-xs text-[var(--text-primary)] leading-snug">
                  {layers.l3.enabled && layers.l3.approved ? (
                    <>
                      If Layers 1 & 2 are exhausted → <strong className="text-[var(--text-primary)]">Layer 3</strong> executes atomic flash loan deleverage (cap <strong className="font-mono">${layers.l3.capacity.toLocaleString("en-US")}</strong>).
                    </>
                  ) : (
                    <span className="text-[var(--text-tertiary)]">
                      Layer 3 (Flash Deleverage): not set up or disabled.
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {layers.l3.enabled && layers.l3.approved ? (
                <span className="text-xs font-mono text-[var(--safe)] font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                </span>
              ) : (
                <Link
                  href="/dashboard/protection"
                  className="text-xs font-mono text-[var(--brand)] hover:underline"
                >
                  Set up →
                </Link>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* ── 3. Three Readiness Cards (L1 / L2 / L3) ───────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Layer 1 Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <LayerBadge layer={1} showName />
              <Switch
                checked={layers.l1.enabled}
                onCheckedChange={(checked) => actions.enableLayer(1, checked)}
              />
            </div>
            <CardTitle className="text-sm mt-3">Wallet Reserve</CardTitle>
            <CardDescription className="text-xs">{layers.l1.description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Approved Cap</span>
                <span className="text-[var(--text-primary)]">{layers.l1.capacity.toLocaleString("en-US")} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Debt Covered</span>
                <span className="text-[var(--text-primary)]">{layers.l1.coversPct}%</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                <span className="text-[var(--text-tertiary)]">Status</span>
                <span className={layers.l1.enabled && layers.l1.approved ? "text-[var(--safe)]" : "text-[var(--text-tertiary)]"}>
                  {layers.l1.enabled && layers.l1.approved ? "Ready ✓" : "Inactive"}
                </span>
              </div>
            </div>

            <Button variant="outline" size="sm" asChild className="w-full text-xs font-mono">
              <Link href="/dashboard/protection">Configure Layer 1</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Layer 2 Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <LayerBadge layer={2} showName />
              <Switch
                checked={layers.l2.enabled}
                onCheckedChange={(checked) => actions.enableLayer(2, checked)}
              />
            </div>
            <CardTitle className="text-sm mt-3">Position Reserve</CardTitle>
            <CardDescription className="text-xs">{layers.l2.description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Redemption Cap</span>
                <span className="text-[var(--text-primary)]">${layers.l2.capacity.toLocaleString("en-US")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Source Position</span>
                <span className="text-[var(--text-secondary)]">Vault Shares</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                <span className="text-[var(--text-tertiary)]">Status</span>
                <span className={layers.l2.enabled && layers.l2.approved ? "text-[var(--safe)]" : "text-[var(--text-tertiary)]"}>
                  {layers.l2.enabled && layers.l2.approved ? "Ready ✓" : "Inactive"}
                </span>
              </div>
            </div>

            <Button variant="outline" size="sm" asChild className="w-full text-xs font-mono">
              <Link href="/dashboard/protection">Configure Layer 2</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Layer 3 Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <LayerBadge layer={3} showName />
              <Switch
                checked={layers.l3.enabled}
                onCheckedChange={(checked) => actions.enableLayer(3, checked)}
              />
            </div>
            <CardTitle className="text-sm mt-3">Flash Deleverage</CardTitle>
            <CardDescription className="text-xs">{layers.l3.description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-xs font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Collateral Cap</span>
                <span className="text-[var(--text-primary)]">${layers.l3.capacity.toLocaleString("en-US")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Max Slippage</span>
                <span className="text-[var(--text-primary)]">{policy.slippageBps} bps</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                <span className="text-[var(--text-tertiary)]">Status</span>
                <span className={layers.l3.enabled && layers.l3.approved ? "text-[var(--safe)]" : "text-[var(--text-tertiary)]"}>
                  {layers.l3.enabled && layers.l3.approved ? "Ready ✓" : "Inactive"}
                </span>
              </div>
            </div>

            <Button variant="outline" size="sm" asChild className="w-full text-xs font-mono">
              <Link href="/dashboard/protection">Configure Layer 3</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── 4. Sentinel, Market Pulse & Activity Grid ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: AI Intelligence (Sentinel + Market Pulse) */}
        <div className="space-y-5">
          {/* Sentinel Status */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[var(--safe-bg)] border border-[var(--border)] flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5 text-[var(--safe)]" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-[var(--text-primary)]">
                    Agent 2: HF Sentinel
                  </h3>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
                    24/7 Rule Monitoring & AI Advisor
                  </p>
                </div>
              </div>
              <Badge variant="safe" size="sm" dot>Active</Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
                <span className="text-[10px] text-[var(--text-tertiary)] block">Last Health Check</span>
                <span className="text-[var(--text-primary)] font-medium">Just now</span>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
                <span className="text-[10px] text-[var(--text-tertiary)] block">Next Scheduled Check</span>
                <span className="text-[var(--safe)] font-medium">in ~45 seconds</span>
              </div>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Sentinel continuously polls Aave oracle feeds. If HF drops below {policy.triggerHF.toFixed(2)}, deterministic keepers execute approved protection layers immediately. AI Sentinel advises via Telegram.
            </p>

            <div className="pt-1">
              <Link
                href="/dashboard/agents"
                className="text-xs font-mono text-[var(--brand)] hover:underline inline-flex items-center gap-1"
              >
                Inspect Sentinel rules →
              </Link>
            </div>
          </Card>

          {/* Market Pulse Brief */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[var(--brand-bg)] border border-[var(--border)] flex items-center justify-center">
                  <Newspaper className="w-3.5 h-3.5 text-[var(--brand)]" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-[var(--text-primary)]">
                    Agent 1: Market Pulse
                  </h3>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
                    Latest Brief · 08:00 UTC
                  </p>
                </div>
              </div>
              <Badge variant="brand" size="sm">Daily Intel</Badge>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              &ldquo;ETH lending utilisation remains elevated at 78.4%. Arbitrum base borrow APY is 3.12%. Liquidations across lending markets spiked 4% in past 24h as spot tested $3,350 support. No debt caps at risk.&rdquo;
            </p>

            <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-[var(--text-tertiary)]">
              <span>Structured data → LLM verified</span>
              <Link href="/dashboard/agents" className="text-[var(--brand)] hover:underline">
                View Agent feed →
              </Link>
            </div>
          </Card>
        </div>

        {/* Right: Recent Activity Audit Log */}
        <Card className="p-5 space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[var(--text-tertiary)]" />
                <h3 className="text-xs font-medium text-[var(--text-primary)]">
                  Recent Interventions & Activity
                </h3>
              </div>
              <Link
                href="/dashboard/activity"
                className="text-xs font-mono text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                View all →
              </Link>
            </div>

            <div className="divide-y divide-[var(--border)] mt-2">
              {recentExecutions.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--text-tertiary)]">
                  No automated interventions triggered yet. Position remains above threshold.
                </div>
              ) : (
                recentExecutions.map((item) => (
                  <div key={item.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                    <div className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded bg-[var(--safe-bg)] border border-[var(--safe-border)] flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle2 className="w-3 h-3 text-[var(--safe)]" />
                      </div>
                      <div>
                        <span className="font-medium text-[var(--text-primary)] block">
                          {item.action.replace("_", " ")}
                        </span>
                        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                          {item.amount} {item.asset} · {item.source}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-mono text-[11px] text-[var(--safe)] block">
                        HF {item.hfBefore} → {item.hfAfter}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                        {item.timestamp}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between text-xs font-mono text-[var(--text-tertiary)]">
            <span>Audit trail preserved</span>
            <Link href="/dashboard/activity" className="text-[var(--brand)] hover:underline">
              Inspect Audit Log →
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { isLive, isSimulation } = useDashboardMode();
  if (!isLive) return <DemoDashboardPage />;
  if (isSimulation) return <SimDashboard />;
  return (
    <LivePage eyebrow="Overview" title="Guardian view" subtitle="What is guarded, how far it is from the trigger and from liquidation, and what is ready to repay.">
      <GuardianView />
    </LivePage>
  );
}

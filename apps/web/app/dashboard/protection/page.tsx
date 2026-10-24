"use client";

import { PageHeader } from "@/components/dashboard/page-header";
import React, { useState } from "react";
import Link from "next/link";
import {
  RotateCcw,
  TrendingDown,
  Sparkles,
} from "lucide-react";
import { useProtection } from "@/hooks/useProtection";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { LayerBadge } from "@/components/ui/layer-badge";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { AmountPresets } from "@/components/ui/amount-presets";
import { demoCapPresets } from "@/lib/cap-presets";
import { ZoneBar } from "@/components/ui/zone-bar";
import { ApprovalExplainer } from "@/components/ui/approval-explainer";
import { TxPreviewModal } from "@/components/dashboard/protection/tx-preview-modal";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { LivePage } from "@/components/dashboard/live/live-page";
import { LiveProtection } from "@/components/dashboard/live/live-protection";

function DemoProtectionPage() {
  const { position, hf, zone, layers, policy, actions } = useProtection();
  const [showExplainer, setShowExplainer] = useState<number | null>(null);
  const [approvingLayer, setApprovingLayer] = useState<1 | 2 | 3 | null>(null);

  const capPresets = demoCapPresets(position?.debtUsd ?? 0, policy.triggerHF, policy.targetHF);

  const getApprovingToken = () => {
    if (approvingLayer === 1) return "USDC";
    if (approvingLayer === 2) return "Vault Shares / aToken";
    return "Aave Flash Loan";
  };

  const getApprovingCap = () => {
    if (approvingLayer === 1) return `${layers.l1.capacity.toLocaleString("en-US")} USDC`;
    if (approvingLayer === 2) return `$${layers.l2.capacity.toLocaleString("en-US")}`;
    return `Up to $${layers.l3.capacity.toLocaleString("en-US")}`;
  };

  return (
    <div className="w-full p-5 md:p-8 space-y-6">
      <PageHeader
        eyebrow="Protection"
        title="Liquidation protection"
        subtitle="Three self-approved layers, always in this order: wallet reserve, vault reserve, flash deleverage."
        actions={
          <>
            <Button variant="outline" size="sm" asChild className="text-xs">
              <Link href="/dashboard/protection/setup">
                <Sparkles className="size-3.5 text-[var(--brand)]" /> Setup wizard
              </Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => actions.simulatePriceDrop(15)} className="text-xs">
              <TrendingDown className="size-3.5 text-[var(--warning)]" /> Simulate a 15% drop
            </Button>
            <Button variant="danger" size="sm" onClick={() => actions.revokeAll()} className="text-xs">
              <RotateCcw className="size-3.5" /> Revoke all
            </Button>
          </>
        }
      />

      {/* Position Status & Zone Bar */}
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {position?.protocol ?? "Aave V3"} Position
              </span>
              <span className="text-xs font-mono text-[var(--text-tertiary)]">
                Arbitrum · Collateral {position?.collateral ?? "4.2 ETH"} (${position?.collateralUsd?.toLocaleString("en-US")}) · Debt {position?.debt ?? "5,400 USDC"}
              </span>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-1 font-mono">
              Liquidation threshold: 0.825 · Oracle: Chainlink ETH/USD
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] block">Health Factor</span>
              <span className="text-2xl font-light font-mono text-[var(--text-primary)]">{hf.toFixed(2)}</span>
            </div>
            <StatusPill zone={zone} size="md" />
          </div>
        </div>

        {/* Zone Bar */}
        <div className="pt-4">
          <ZoneBar hf={hf} trigger={policy.triggerHF} target={policy.targetHF} />
        </div>
      </Card>

      {/* 3 Layer Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Layer 1: Wallet Reserve */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <LayerBadge layer={1} showName />
              <Switch
                checked={layers.l1.enabled}
                onCheckedChange={(checked) => actions.enableLayer(1, checked)}
              />
            </div>
            <CardTitle className="text-sm mt-3">Layer 1: Wallet Reserve</CardTitle>
            <CardDescription className="text-xs">{layers.l1.description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div>
              <label className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase block mb-1">
                Approved Cap (USDC)
              </label>
              <AmountPresets
                className="mb-2"
                presets={capPresets}
                current={layers.l1.capacity}
                onSelect={(val) => actions.setCap(1, val)}
                disabled={!layers.l1.enabled}
              />
              <NumberInput
                value={layers.l1.capacity}
                onChange={(val) => actions.setCap(1, val)}
                token="USDC"
                min={0}
                max={50000}
                step={100}
                disabled={!layers.l1.enabled}
              />
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Debt Coverage</span>
                <span className="text-[var(--text-primary)]">{layers.l1.coversPct}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Allowance Status</span>
                <span className={layers.l1.approved ? "text-[var(--safe)]" : "text-[var(--text-tertiary)]"}>
                  {layers.l1.approved ? "Approved ✓" : "Not Approved"}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowExplainer(showExplainer === 1 ? null : 1)}
              className="text-[11px] text-[var(--brand)] hover:underline font-mono inline-flex items-center gap-1 cursor-pointer"
            >
              {showExplainer === 1 ? "Hide security info" : "Security & revocation info"}
            </button>

            {showExplainer === 1 && (
              <ApprovalExplainer
                layer={1}
                tokenSymbol="USDC"
                amountCap={`${layers.l1.capacity} USDC`}
              />
            )}
          </CardContent>

          <CardFooter className="pt-2 border-t border-[var(--border)] flex justify-between">
            {layers.l1.approved ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => actions.revoke(1)}
                className="w-full text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:border-[var(--danger-border)]"
              >
                Revoke Allowance (0)
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setApprovingLayer(1)}
                className="w-full text-xs"
              >
                Approve Layer 1
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Layer 2: Position Reserve */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <LayerBadge layer={2} showName />
              <Switch
                checked={layers.l2.enabled}
                onCheckedChange={(checked) => actions.enableLayer(2, checked)}
              />
            </div>
            <CardTitle className="text-sm mt-3">Layer 2: Position Reserve</CardTitle>
            <CardDescription className="text-xs">{layers.l2.description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div>
              <label className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase block mb-1">
                Redemption Cap (USD)
              </label>
              <AmountPresets
                className="mb-2"
                presets={capPresets}
                current={layers.l2.capacity}
                onSelect={(val) => actions.setCap(2, val)}
                disabled={!layers.l2.enabled}
              />
              <NumberInput
                value={layers.l2.capacity}
                onChange={(val) => actions.setCap(2, val)}
                token="USD"
                min={0}
                max={50000}
                step={250}
                disabled={!layers.l2.enabled}
              />
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Debt Coverage</span>
                <span className="text-[var(--text-primary)]">{layers.l2.coversPct}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Source Position</span>
                <span className="text-[var(--text-secondary)]">Morpho Vault / aToken</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowExplainer(showExplainer === 2 ? null : 2)}
              className="text-[11px] text-[var(--brand)] hover:underline font-mono inline-flex items-center gap-1 cursor-pointer"
            >
              {showExplainer === 2 ? "Hide security info" : "Security & revocation info"}
            </button>

            {showExplainer === 2 && (
              <ApprovalExplainer
                layer={2}
                tokenSymbol="Vault Shares"
                amountCap={`$${layers.l2.capacity}`}
              />
            )}
          </CardContent>

          <CardFooter className="pt-2 border-t border-[var(--border)] flex justify-between">
            {layers.l2.approved ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => actions.revoke(2)}
                className="w-full text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:border-[var(--danger-border)]"
              >
                Revoke Allowance (0)
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setApprovingLayer(2)}
                className="w-full text-xs"
              >
                Approve Layer 2
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Layer 3: Flash Deleverage */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <LayerBadge layer={3} showName />
              <Switch
                checked={layers.l3.enabled}
                onCheckedChange={(checked) => actions.enableLayer(3, checked)}
              />
            </div>
            <CardTitle className="text-sm mt-3">Layer 3: Flash Deleverage</CardTitle>
            <CardDescription className="text-xs">{layers.l3.description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div>
              <label className="text-[11px] font-mono text-[var(--text-tertiary)] uppercase block mb-1">
                Max Collateral Sold (USD)
              </label>
              <NumberInput
                value={layers.l3.capacity}
                onChange={(val) => actions.setCap(3, val)}
                token="USD"
                min={0}
                max={100000}
                step={500}
                disabled={!layers.l3.enabled}
              />
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Max Slippage</span>
                <span className="text-[var(--text-primary)]">{policy.slippageBps} bps</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-tertiary)]">Flash Fee</span>
                <span className="text-[var(--safe)]">0.05% (Aave V3)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowExplainer(showExplainer === 3 ? null : 3)}
              className="text-[11px] text-[var(--brand)] hover:underline font-mono inline-flex items-center gap-1 cursor-pointer"
            >
              {showExplainer === 3 ? "Hide security info" : "Security & revocation info"}
            </button>

            {showExplainer === 3 && (
              <ApprovalExplainer
                layer={3}
                tokenSymbol="Flash Loan"
                amountCap={`Up to $${layers.l3.capacity}`}
              />
            )}
          </CardContent>

          <CardFooter className="pt-2 border-t border-[var(--border)] flex justify-between">
            {layers.l3.approved ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => actions.revoke(3)}
                className="w-full text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:border-[var(--danger-border)]"
              >
                Revoke Allowance (0)
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setApprovingLayer(3)}
                className="w-full text-xs"
              >
                Approve Layer 3
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>

      {approvingLayer !== null && (
        <TxPreviewModal
          open={approvingLayer !== null}
          onOpenChange={(open) => !open && setApprovingLayer(null)}
          layer={approvingLayer}
          tokenSymbol={getApprovingToken()}
          amountCap={getApprovingCap()}
          onConfirm={() => {
            if (approvingLayer) {
              actions.approve(approvingLayer);
            }
          }}
        />
      )}
    </div>
  );
}

export default function ProtectionPage() {
  const { isLive } = useDashboardMode();
  if (!isLive) return <DemoProtectionPage />;
  return (
    <LivePage eyebrow="Protection" title="Liquidation protection" subtitle="Approve a capped reserve and save your policy on-chain. Revoke anytime.">
      <LiveProtection />
    </LivePage>
  );
}

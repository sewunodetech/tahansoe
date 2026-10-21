"use client";

import { useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LayerBadge } from "@/components/ui/layer-badge";
import { ShieldCheck, ShieldAlert, RotateCcw, ArrowDown } from "lucide-react";

type LayerData = {
  layer: 1 | 2 | 3;
  name: string;
  tokenApproved: string;
  whenItRuns: string;
  whatItDoes: string;
  cost: string;
  copy: string;
  allows: string;
  cannotDo: string;
  revokeMethod: string;
};

const LAYERS: LayerData[] = [
  {
    layer: 1,
    name: "Wallet Reserve",
    tokenApproved: "Debt Token (e.g. USDC)",
    whenItRuns: "Health Factor < 1.30 (Trigger)",
    whatItDoes: "Repays loan directly from your approved wallet balance to restore HF back to 1.60.",
    cost: "0% protocol fee + standard network gas",
    copy: "Allow Tahansoe to use up to 500 USDC from your wallet — only to repay your own Aave debt, never to anywhere else.",
    allows: "Pulls up to approved cap strictly for debt repayment to Aave V3.",
    cannotDo: "Cannot transfer funds to any third-party address or exceed cap.",
    revokeMethod: "Revoke anytime in the dashboard or set wallet allowance to 0.",
  },
  {
    layer: 2,
    name: "Position Reserve",
    tokenApproved: "Vault Shares (e.g. Morpho Vault, Aave aToken)",
    whenItRuns: "HF < 1.30 and Layer 1 wallet reserve is empty or exhausted",
    whatItDoes: "Redeems yield-bearing vault shares into debt tokens and immediately repays debt.",
    cost: "0% protocol fee + vault redemption gas",
    copy: "Redeem shares from a secondary vault to extinguish debt without keeping idle stablecoins in your hot wallet.",
    allows: "Redeems designated ERC-4626 vault shares exclusively into debt tokens.",
    cannotDo: "Cannot touch unapproved vaults or redirect redeemed capital.",
    revokeMethod: "Disable or adjust secondary vault allocation in Protection settings.",
  },
  {
    layer: 3,
    name: "Flash Deleverage",
    tokenApproved: "Atomic Flash Loan + Collateral Swap",
    whenItRuns: "HF < 1.30 and Layers 1 & 2 are insufficient to prevent liquidation",
    whatItDoes: "Borrows debt via flash loan, repays loan, withdraws collateral, swaps to settle flash loan in one block.",
    cost: "Flash loan fee (~0.05%) + DEX swap slippage (capped)",
    copy: "Emergency self-deleveraging when you have zero spare capital. Lowers debt and collateral proportionally to preserve equity.",
    allows: "Executes an atomic flash loan borrow, debt repay, and collateral swap.",
    cannotDo: "Cannot execute without restoring HF or exceed your max slippage limit.",
    revokeMethod: "Opt out of Layer 3 execution anytime in Protection settings.",
  },
];

export function ProtectionLayers() {
  const [marketDrop, setMarketDrop] = useState(25);

  const activeLayer = marketDrop < 15 ? 0 : marketDrop < 30 ? 1 : marketDrop < 42 ? 2 : 3;

  return (
    <section id="layers" className="py-20 md:py-28 border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col items-start gap-4 max-w-3xl mb-12">
          <Eyebrow dot variant="brand">
            Defense Architecture
          </Eyebrow>
          <h2 className="font-display font-light text-3xl sm:text-4xl lg:text-5xl tracking-tight text-[var(--text-primary)] leading-tight">
            Three automated defense lines. You approve each one.
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Choose the exact assets and strategies Tahansoe is authorized to use. Approvals are strictly bounded, non-custodial, and revokable at any block.
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-6 mb-12 shadow-xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-tertiary)] block">
                Interactive Simulation: Cascade In Action
              </span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                Simulate ETH drawdown: −{marketDrop}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-[var(--text-tertiary)]">Active Defense:</span>
              {activeLayer === 0 ? (
                <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-md bg-[var(--safe-bg)] text-[var(--safe)] border border-[var(--safe-border)]">
                  Monitoring (No Action Needed)
                </span>
              ) : (
                <LayerBadge layer={activeLayer as 1 | 2 | 3} showName size="md" />
              )}
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={50}
            value={marketDrop}
            onChange={(e) => setMarketDrop(Number(e.target.value))}
            className="w-full h-2 bg-[var(--bg-elevated)] rounded-lg appearance-none cursor-pointer accent-[var(--brand)]"
          />

          <div className="grid grid-cols-4 gap-2 pt-3 text-[10px] sm:text-xs font-mono text-[var(--text-tertiary)]">
            <div className={activeLayer === 0 ? "text-[var(--safe)] font-semibold" : ""}>
              0-14% · Safe Zone
            </div>
            <div className={activeLayer === 1 ? "text-[var(--brand)] font-semibold" : ""}>
              15-29% · Layer 1 Kicks In
            </div>
            <div className={activeLayer === 2 ? "text-[var(--color-brand-300)] font-semibold" : ""}>
              30-41% · Layer 2 Cascades
            </div>
            <div className={activeLayer === 3 ? "text-[var(--warning)] font-semibold" : ""}>
              42%+ · Layer 3 Flash Deleverage
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {LAYERS.map((item) => {
            const isHighlighted = activeLayer === item.layer;

            return (
              <div
                key={item.layer}
                className={`rounded-2xl border transition-all duration-200 flex flex-col p-6 sm:p-7 ${
                  isHighlighted
                    ? "border-[var(--brand)] bg-[var(--bg)] shadow-md ring-1 ring-[var(--brand)]/30"
                    : "border-[var(--border)] bg-[var(--bg-subtle)]"
                }`}
              >
                <div className="flex items-center justify-between pb-4 border-b border-[var(--border)] mb-5">
                  <div className="flex items-center gap-2">
                    <LayerBadge layer={item.layer} showName size="md" />
                  </div>
                  {isHighlighted && (
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[var(--brand-bg)] text-[var(--brand)] border border-[var(--brand-border)] font-medium">
                      Active Trigger
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-3 mb-6">
                  <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">
                    {item.tokenApproved}
                  </p>
                  <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">
                    {item.copy}
                  </p>
                </div>

                <div className="space-y-4 pt-4 border-t border-[var(--border)] text-xs flex-1">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] block mb-1">
                      Execution Trigger
                    </span>
                    <span className="text-[var(--text-secondary)] font-medium">
                      {item.whenItRuns}
                    </span>
                  </div>

                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] block mb-1">
                      Mechanics
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      {item.whatItDoes}
                    </span>
                  </div>

                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] block mb-1">
                      Protocol Cost
                    </span>
                    <span className="text-[var(--text-secondary)] font-mono">
                      {item.cost}
                    </span>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-[var(--border)] space-y-2.5 text-[11px]">
                  <div className="flex items-start gap-1.5 text-[var(--safe)]">
                    <ShieldCheck className="size-3.5 shrink-0 mt-0.5" />
                    <span>{item.allows}</span>
                  </div>
                  <div className="flex items-start gap-1.5 text-[var(--warning)]">
                    <ShieldAlert className="size-3.5 shrink-0 mt-0.5" />
                    <span>{item.cannotDo}</span>
                  </div>
                  <div className="flex items-start gap-1.5 text-[var(--text-tertiary)] pt-1">
                    <RotateCcw className="size-3.5 shrink-0 mt-0.5 text-[var(--brand)]" />
                    <span>{item.revokeMethod}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium text-[var(--text-primary)]">Execution Order:</span>
            <span>Layer 1 (Hot)</span>
            <ArrowDown className="size-3.5 -rotate-90 text-[var(--text-tertiary)]" />
            <span>Layer 2 (Yield Vault)</span>
            <ArrowDown className="size-3.5 -rotate-90 text-[var(--text-tertiary)]" />
            <span>Layer 3 (Flash Deleverage)</span>
          </div>
          <span className="hidden sm:inline font-mono text-[11px] text-[var(--text-tertiary)]">
            Atomic batch execution in a single transaction
          </span>
        </div>
      </div>
    </section>
  );
}

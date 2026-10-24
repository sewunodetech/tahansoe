"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatUnits, type Address } from "viem";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Ban,
  CheckCircle2,
  Edit2,
  Loader2,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { useGuardianV4 } from "@/hooks/useGuardianV4";
import { usePositions } from "@/hooks/usePositions";
import { moveDebtPriority, type ProtectedPositionV4 } from "@/lib/guardian-v4";
import { PROTOCOL_LABEL } from "@/components/dashboard/positions/status-badge";
import { PositionProtectionDialog } from "./position-protection-dialog";
import type { PositionDetail } from "@tahansoe/domain";

export interface ProtectedPositionsListProps {
  initialPositions?: ProtectedPositionV4[];
  initialPriorityOrder?: Address[];
}

export function ProtectedPositionsList({
  initialPositions,
  initialPriorityOrder,
}: ProtectedPositionsListProps = {}) {
  const g4 = useGuardianV4();
  const { positions } = usePositions();
  const [editingPos, setEditingPos] = useState<PositionDetail | null>(null);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [localPriorityOrder, setLocalPriorityOrder] = useState<Address[] | null>(null);

  const priorityOrder = localPriorityOrder ?? initialPriorityOrder ?? g4.aaveDebtAssets;
  const protectedList = initialPositions ?? g4.protectedPositions;

  const handleDisable = async (pos: ProtectedPositionV4) => {
    setActionLoadingKey(`disable:${pos.positionKey}`);
    try {
      if (pos.protocol === "aave-v3") {
        await g4.actions.disableAavePolicy(pos.keyIdentifier as Address);
      } else {
        await g4.actions.disableMorphoPolicy(pos.keyIdentifier as `0x${string}`);
      }
      await g4.actions.refetch();
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleRevoke = async (pos: ProtectedPositionV4) => {
    setActionLoadingKey(`revoke:${pos.positionKey}`);
    try {
      // For Aave, keyIdentifier is the debtAsset
      // For Morpho, revoke loan token allowance to the Morpho guardian
      const tokenAddress = pos.keyIdentifier as Address;
      await g4.actions.revoke(tokenAddress, pos.guardianAddress);
      await g4.actions.refetch();
    } finally {
      setActionLoadingKey(null);
    }
  };

  const handleMovePriority = async (asset: Address, direction: "up" | "down") => {
    const newOrder = moveDebtPriority(priorityOrder, asset, direction);
    setLocalPriorityOrder(newOrder);
    setActionLoadingKey(`priority:${asset}`);
    try {
      await g4.actions.setDebtPriority(newOrder);
      await g4.actions.refetch();
    } finally {
      setActionLoadingKey(null);
    }
  };

  const findPositionDetail = (pos: ProtectedPositionV4): PositionDetail | undefined => {
    return positions.find((p) => {
      if (pos.protocol === "aave-v3") {
        return p.position.protocol === "aave-v3" && p.position.chainId === pos.chainId;
      }
      return p.position.id.toLowerCase() === pos.keyIdentifier.toLowerCase();
    })?.position;
  };

  return (
    <div className="space-y-6">
      {/* Priority control for Aave when multiple debt assets are protected */}
      {priorityOrder.length > 1 && (
        <Card className="p-4 bg-[var(--bg-subtle)] border-[var(--border)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)]">
                Aave debt repayment priority
              </h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                The keeper executes protection in this order when multiple debts reach their trigger.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {priorityOrder.map((asset, index) => (
              <div
                key={asset}
                className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="size-5 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-strong)] flex items-center justify-center text-[10px] font-mono text-[var(--text-secondary)]">
                    {index + 1}
                  </span>
                  <span className="font-mono text-xs text-[var(--text-primary)]">
                    {asset.slice(0, 10)}...{asset.slice(-6)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={index === 0 || actionLoadingKey === `priority:${asset}`}
                    onClick={() => handleMovePriority(asset, "up")}
                    className="size-7 p-0"
                    aria-label="Move up"
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={index === priorityOrder.length - 1 || actionLoadingKey === `priority:${asset}`}
                    onClick={() => handleMovePriority(asset, "down")}
                    className="size-7 p-0"
                    aria-label="Move down"
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* List of Protected Positions */}
      {protectedList.length === 0 ? (
        <Card className="p-8 text-center space-y-3">
          <div className="size-10 rounded-full bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center mx-auto text-[var(--text-tertiary)]">
            <Shield className="size-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              No protected positions yet
            </h3>
            <p className="text-xs text-[var(--text-tertiary)] max-w-md mx-auto mt-1">
              Select any of your borrow positions on the Positions page to configure automated liquidation protection.
            </p>
          </div>
          <Button size="sm" asChild className="mt-2">
            <Link href="/dashboard/positions">
              View positions <ArrowRight className="size-3.5 ml-1" />
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {protectedList.map((pos) => {
            const pDetail = findPositionDetail(pos);
            const isAave = pos.protocol === "aave-v3";
            const isLoadingThis =
              actionLoadingKey === `disable:${pos.positionKey}` ||
              actionLoadingKey === `revoke:${pos.positionKey}`;

            return (
              <Card key={pos.positionKey} className="p-5 flex flex-col gap-4">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--border)]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-primary)] border border-[var(--border)]">
                        {PROTOCOL_LABEL[pos.protocol]}
                      </span>
                      <span className="text-xs font-mono text-[var(--text-secondary)]">
                        {isAave ? `Debt asset: ${pos.keyIdentifier.slice(0, 8)}...` : `Market: ${pos.keyIdentifier.slice(0, 10)}...`}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-1 truncate max-w-md">
                      {pos.positionKey}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[var(--safe)] inline-flex items-center gap-1">
                      <CheckCircle2 className="size-3.5" /> Protected
                    </span>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Trigger HF</p>
                    <p className="text-base text-[var(--text-primary)] mt-0.5">
                      {pos.policy.triggerHf.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Target HF</p>
                    <p className="text-base text-[var(--text-primary)] mt-0.5">
                      {pos.policy.targetHf.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Max repay cap</p>
                    <p className="text-base text-[var(--text-primary)] mt-0.5 truncate">
                      {formatUnits(pos.policy.maxRepayPerAction, 6)} tokens
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase">Fee estimate</p>
                    <p className="text-base text-[var(--text-primary)] mt-0.5">
                      {pos.feeQuote?.eligible ? `${formatUnits(pos.feeQuote.fee, 6)} fee` : "15 bps fee"}
                    </p>
                  </div>
                </div>

                {/* Active Layers */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--text-tertiary)]">Layers:</span>
                  <LayerBadge layer={1} showName />
                  {((isAave && pos.layer2Aave && pos.layer2Aave.kind > 0) ||
                    (!isAave && pos.layer2Morpho && pos.layer2Morpho.vault)) && (
                    <LayerBadge layer={2} showName />
                  )}
                  {isAave && pos.layer3Aave && pos.layer3Aave.enabled && (
                    <LayerBadge layer={3} showName />
                  )}
                </div>

                {/* Action Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    {pDetail && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingPos(pDetail)}
                        disabled={isLoadingThis}
                        className="text-xs"
                      >
                        <Edit2 className="size-3.5 mr-1" /> Edit
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevoke(pos)}
                      disabled={isLoadingThis}
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--danger)]"
                    >
                      Revoke allowance
                    </Button>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDisable(pos)}
                    disabled={isLoadingThis}
                    className="text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                  >
                    {isLoadingThis ? (
                      <Loader2 className="size-3.5 animate-spin mr-1" />
                    ) : (
                      <Ban className="size-3.5 mr-1" />
                    )}
                    Disable policy
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {editingPos && (
        <PositionProtectionDialog
          open={Boolean(editingPos)}
          onOpenChange={(open) => !open && setEditingPos(null)}
          position={editingPos}
          onSuccess={() => {
            setEditingPos(null);
            g4.actions.refetch();
          }}
        />
      )}
    </div>
  );
}

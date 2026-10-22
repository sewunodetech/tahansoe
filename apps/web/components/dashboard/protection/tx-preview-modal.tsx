"use client";

import * as React from "react";
import { CheckCircle2, ExternalLink, Loader2, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LayerBadge } from "@/components/ui/layer-badge";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ApprovalExplainer } from "@/components/ui/approval-explainer";

export interface TxPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layer: 1 | 2 | 3;
  tokenSymbol: string;
  amountCap: string;
  onConfirm: () => void;
}

const GUARDIAN_ADDRESS = "0x1A5D84988F47D3B5e56e0777B08B5cb4a14CD97E";
const ARBITRUM_CHAIN_ID = "Arbitrum Sepolia (421614)";

export function TxPreviewModal({
  open,
  onOpenChange,
  layer,
  tokenSymbol,
  amountCap,
  onConfirm,
}: TxPreviewModalProps) {
  const [submitting, setSubmitting] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSubmitting(false);
      setSuccess(false);
    }
    onOpenChange(nextOpen);
  };

  const handleConfirm = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSuccess(true);
      setTimeout(() => {
        onConfirm();
        handleClose(false);
      }, 700);
    }, 1100);
  };

  const getFunctionCall = () => {
    switch (layer) {
      case 1:
        return `approve(${GUARDIAN_ADDRESS.slice(0, 6)}…${GUARDIAN_ADDRESS.slice(-4)}, ${amountCap})`;
      case 2:
        return `setVaultAuthorization(${GUARDIAN_ADDRESS.slice(0, 6)}…${GUARDIAN_ADDRESS.slice(-4)}, ${amountCap})`;
      case 3:
        return `authorizeFlashDeleverage(maxCollateral: ${amountCap}, slippage: 50 bps)`;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Eyebrow variant="brand" dot>
              TRANSACTION PREVIEW
            </Eyebrow>
            <LayerBadge layer={layer} showName size="sm" />
          </div>
          <DialogTitle className="text-lg font-light text-[var(--text-primary)]">
            Review Approval & Permissions
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--text-tertiary)]">
            Preview the on-chain interaction before simulated confirmation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2">
          {/* Transaction Metadata Card */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3.5 space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between py-1 border-b border-[var(--border)]">
              <span className="text-[var(--text-tertiary)]">Network</span>
              <span className="text-[var(--text-primary)] font-medium">{ARBITRUM_CHAIN_ID}</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-[var(--border)]">
              <span className="text-[var(--text-tertiary)]">Contract / Spender</span>
              <span className="text-[var(--text-primary)] flex items-center gap-1">
                <span>{GUARDIAN_ADDRESS.slice(0, 8)}…{GUARDIAN_ADDRESS.slice(-6)}</span>
                <ExternalLink className="size-3 text-[var(--text-tertiary)]" />
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-[var(--border)]">
              <span className="text-[var(--text-tertiary)]">Function Call</span>
              <span className="text-[var(--brand)] text-[11px] truncate max-w-[280px]">
                {getFunctionCall()}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-[var(--border)]">
              <span className="text-[var(--text-tertiary)]">Approved Limit</span>
              <span className="text-[var(--text-primary)] font-semibold">{amountCap}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[var(--text-tertiary)]">Estimated Gas Fee</span>
              <span className="text-[var(--safe)]">~0.00018 ETH ($0.58)</span>
            </div>
          </div>

          {/* Integrated Approval Explainer */}
          <div>
            <ApprovalExplainer
              layer={layer}
              tokenSymbol={tokenSymbol}
              amountCap={amountCap}
            />
          </div>
        </div>

        <DialogFooter className="mt-4 flex flex-row items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting || success}
          >
            Cancel
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={submitting || success}
            className="min-w-[170px]"
          >
            {success ? (
              <span className="flex items-center gap-1.5 text-white">
                <CheckCircle2 className="size-3.5 stroke-[2.5]" />
                Approved
              </span>
            ) : submitting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Simulating Wallet…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Zap className="size-3.5" />
                Confirm Approval (Demo)
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

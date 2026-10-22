import * as React from "react";
import { ShieldCheck, ShieldAlert, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { LayerBadge } from "./layer-badge";

export interface ApprovalExplainerProps extends React.HTMLAttributes<HTMLDivElement> {
  layer: 1 | 2 | 3;
  tokenSymbol: string;
  amountCap?: string;
  allows?: string[];
  cannotDo?: string[];
  howToRevoke?: string;
}

const DEFAULT_EXPLANATIONS: Record<
  1 | 2 | 3,
  { allows: string[]; cannotDo: string[]; howToRevoke: string }
> = {
  1: {
    allows: [
      "Allow Tahansoe to transfer up to the approved cap from your wallet",
      "Executes only when Health Factor drops below your trigger",
      "Funds are used exclusively to repay your debt",
    ],
    cannotDo: [
      "Cannot transfer funds to any third-party address",
      "Cannot pull more than your approved cap",
      "Cannot execute when Health Factor is above the trigger",
    ],
    howToRevoke:
      "Revoke anytime in the Protection dashboard or by setting allowance to 0 in your wallet.",
  },
  2: {
    allows: [
      "Allow Tahansoe to redeem shares from your secondary vault",
      "Redeemed capital is routed directly into debt repayment",
      "Only activates when Layer 1 wallet reserve is insufficient",
    ],
    cannotDo: [
      "Cannot touch unapproved positions",
      "Cannot withdraw more than your designated cap",
      "Cannot redirect redeemed funds anywhere except debt repayment",
    ],
    howToRevoke: "Revoke anytime in Protection settings by disabling Layer 2.",
  },
  3: {
    allows: [
      "Authorizes an atomic flash loan to repay debt in a single transaction",
      "Withdraws a calibrated amount of collateral to settle the flash loan",
      "Runs only when Layers 1 and 2 are exhausted and HF is Critical",
    ],
    cannotDo: [
      "Cannot execute without improving Health Factor",
      "Cannot exceed your maximum slippage tolerance",
      "No residual debt or funds can remain in the contract",
    ],
    howToRevoke: "Disable Layer 3 in Protection settings at any time.",
  },
};

/**
 * Morpho approval explainer box.
 * Displays "What this allows", "What it cannot do", and "How to revoke"
 * for each of the three self-approved protection layers.
 */
export function ApprovalExplainer({
  layer,
  tokenSymbol,
  amountCap,
  allows,
  cannotDo,
  howToRevoke,
  className,
  ...props
}: ApprovalExplainerProps) {
  const defaults = DEFAULT_EXPLANATIONS[layer];
  const allowList = allows || defaults.allows;
  const cannotList = cannotDo || defaults.cannotDo;
  const revokeText = howToRevoke || defaults.howToRevoke;

  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-4 text-xs text-[var(--text-primary)] space-y-3.5",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <LayerBadge layer={layer} showName />
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
            {tokenSymbol}
            {amountCap ? ` · Cap: ${amountCap}` : ""}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--safe)]">
          <ShieldCheck className="size-3.5 shrink-0" />
          <span>What this allows</span>
        </div>
        <ul className="space-y-1 pl-5 list-disc text-[var(--text-secondary)] text-[11px] leading-relaxed">
          {allowList.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--warning)]">
          <ShieldAlert className="size-3.5 shrink-0" />
          <span>What it cannot do</span>
        </div>
        <ul className="space-y-1 pl-5 list-disc text-[var(--text-secondary)] text-[11px] leading-relaxed">
          {cannotList.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="pt-2 border-t border-[var(--border)] flex items-start gap-1.5 text-[var(--text-tertiary)] text-[11px]">
        <RotateCcw className="size-3.5 shrink-0 mt-0.5 text-[var(--brand)]" />
        <span className="leading-relaxed">
          <strong className="text-[var(--text-secondary)] font-medium">How to revoke: </strong>
          {revokeText}
        </span>
      </div>
    </div>
  );
}

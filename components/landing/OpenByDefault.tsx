import { Eyebrow } from "@/components/ui/eyebrow";
import { ArrowUpRight, Code2, ExternalLink } from "lucide-react";

const CONTRACT_ADDRESS = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";
const ARBISCAN_URL = `https://sepolia.arbiscan.io/address/${CONTRACT_ADDRESS}`;

const CODE_SNIPPET = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPool } from "./interfaces/IPool.sol";
import { IERC20 } from "./interfaces/IERC20.sol";

contract TahansoeGuardian {
    struct Policy {
        bool enabled;
        address debtAsset;
        uint128 triggerHf;  // 1.30e18
        uint128 targetHf;   // 1.60e18
        uint256 maxRepayCap;
    }

    mapping(address => Policy) public policies;

    /// @notice Anyone can trigger remediation once HF drops below policy threshold.
    /// @dev Protects user by repaying debt from pre-approved reserves.
    function protect(address user) external nonReentrant {
        Policy memory policy = policies[user];
        require(policy.enabled, "Policy not active");

        uint256 currentHf = getHealthFactor(user);
        require(currentHf < policy.triggerHf, "Health factor above trigger");

        uint256 repayAmount = quoteRepay(user, policy.targetHf);
        if (repayAmount > policy.maxRepayCap) {
            repayAmount = policy.maxRepayCap;
        }

        // Pull pre-approved debt token and repay Aave debt on behalf of user
        IERC20(policy.debtAsset).transferFrom(user, address(this), repayAmount);
        IERC20(policy.debtAsset).approve(address(AAVE_POOL), repayAmount);
        AAVE_POOL.repay(policy.debtAsset, repayAmount, 2, user);

        require(getHealthFactor(user) > currentHf, "HF did not improve");
        emit PositionProtected(user, currentHf, getHealthFactor(user), repayAmount);
    }
}`;

export function OpenByDefault() {
  return (
    <section className="py-20 md:py-28 border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
          <div className="lg:col-span-5 flex flex-col gap-6">
            <Eyebrow dot variant="brand">
              Transparency
            </Eyebrow>

            <h2 className="font-display font-light text-3xl sm:text-4xl lg:text-5xl tracking-tight text-[var(--text-primary)] leading-tight">
              Open by default. Verified on-chain.
            </h2>

            <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
              <p>
                Tahansoe is built on immutable, permissionless primitives. Any keeper or automated scheduler can invoke{" "}
                <code className="font-mono text-xs text-[var(--text-primary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                  protect(user)
                </code>{" "}
                when your Health Factor breaches the configured trigger.
              </p>
              <p>
                The contract can never transfer tokens to an unauthorized address, never borrows funds in your name without an atomic rebalance, and cannot block you from revoking approvals at any time.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-5 flex flex-col gap-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                Arbitrum Sepolia Deployment
              </span>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs text-[var(--brand)] break-all select-all">
                  {CONTRACT_ADDRESS}
                </code>
              </div>
              <a
                href={ARBISCAN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)] hover:text-[var(--brand)] transition-colors pt-1"
              >
                <span>View on Arbiscan</span>
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] overflow-hidden shadow-xs">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--bg)]">
              <div className="flex items-center gap-2">
                <Code2 className="size-4 text-[var(--text-tertiary)]" />
                <span className="font-mono text-xs text-[var(--text-secondary)] font-medium">
                  TahansoeGuardian.sol
                </span>
              </div>
              <a
                href={ARBISCAN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--brand)] hover:underline"
              >
                <span>Contract Code</span>
                <ArrowUpRight className="size-3" />
              </a>
            </div>

            <div className="p-4 sm:p-6 overflow-x-auto bg-[var(--bg)]/50">
              <pre className="font-mono text-[11px] sm:text-xs leading-relaxed text-[var(--text-secondary)]">
                <code>{CODE_SNIPPET}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

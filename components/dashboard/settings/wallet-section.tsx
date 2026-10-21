"use client";

import React, { useState } from "react";
import { useAccount, useDisconnect, useChainId, useChains } from "wagmi";
import { ShieldCheck, Copy, CheckCheck, LogOut } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function WalletSection() {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const chains = useChains();
  const chain = chains.find((c) => c.id === chainId);

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shortAddress = address
    ? `${address.slice(0, 8)}...${address.slice(-6)}`
    : "0x1A5D...D97E (Demo Account)";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wallet & Network Connection</CardTitle>
        <CardDescription>
          Account authorizations and smart contract deployment network
        </CardDescription>
      </CardHeader>

      <CardContent className="divide-y divide-[var(--border)]">
        <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0">
          <div>
            <p className="text-xs font-medium text-[var(--text-primary)]">Connected Address</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
              Signs user policy changes and approves layer allowance contracts
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] font-mono text-xs text-[var(--text-secondary)]">
              <ShieldCheck className="size-3.5 text-[var(--brand)]" />
              <span>{shortAddress}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-2.5 text-xs font-mono"
            >
              {copied ? (
                <CheckCheck className="size-3.5 text-[var(--safe)]" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 py-3.5">
          <div>
            <p className="text-xs font-medium text-[var(--text-primary)]">Active Network</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
              Arbitrum Sepolia Guardian Module contract deployment
            </p>
          </div>
          <div className="flex items-center gap-2 h-8 px-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] font-mono text-xs text-[var(--text-primary)]">
            <span className="size-2 rounded-full bg-[var(--safe)] animate-pulse" />
            <span>{chain?.name ?? "Arbitrum Sepolia"}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 py-3.5 last:pb-0">
          <div>
            <p className="text-xs font-medium text-[var(--text-primary)]">Session Connection</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
              Disconnect current session and return to landing page
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => disconnect()}
            className="text-xs font-mono text-[var(--danger)] hover:bg-[var(--danger-bg)] gap-1.5"
          >
            <LogOut className="size-3.5" /> Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

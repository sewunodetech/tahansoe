"use client";

import React from "react";
import { ShieldCheck, Bot, ExternalLink, Award, FileJson, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAgentIdentity } from "@/lib/erc8004/useAgentIdentity";
import { LIVE_CHAIN_CONFIG } from "@/lib/contracts";

export interface AgentCardProps {
  agentId?: bigint;
  className?: string;
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function AgentCard({ agentId = 1n, className }: AgentCardProps) {
  const {
    loading,
    registered,
    owner,
    agentWallet,
    agentURI,
    metadata,
    reputation,
  } = useAgentIdentity(agentId);

  const explorerBase = LIVE_CHAIN_CONFIG.explorer;
  const identityRegistry = LIVE_CHAIN_CONFIG.erc8004?.identity;
  const reputationRegistry = LIVE_CHAIN_CONFIG.erc8004?.reputation;

  const agentName = metadata?.name ?? "Tahansoe Protection Agent";
  const agentDesc =
    metadata?.description ??
    "Autonomous non-custodial risk agent protecting on-chain borrow positions from liquidation.";
  const strategyVersion = metadata?.strategyVersion ?? "pp-2026.11.1";

  if (loading) {
    return (
      <Card className={className} data-testid="agent-card-loading">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-[var(--brand)] animate-pulse" />
              <CardTitle className="text-base font-semibold">
                Tahansoe Protection Agent
              </CardTitle>
            </div>
            <Badge variant="secondary" size="sm">
              Loading Identity…
            </Badge>
          </div>
          <CardDescription className="text-xs text-[var(--text-tertiary)]">
            Checking ERC-8004 on-chain registry on {LIVE_CHAIN_CONFIG.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="h-20 rounded-lg bg-[var(--bg-subtle)] animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!registered) {
    return (
      <Card className={className} data-testid="agent-card-unregistered">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-[var(--text-tertiary)]" />
              <CardTitle className="text-base font-semibold">
                Protection Strategy Agent
              </CardTitle>
            </div>
            <Badge variant="secondary" size="sm">
              Not Registered (ERC-8004)
            </Badge>
          </div>
          <CardDescription className="text-xs text-[var(--text-tertiary)]">
            Autonomous agent identity on {LIVE_CHAIN_CONFIG.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-secondary)] space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="size-4 text-[var(--warning)] shrink-0 mt-0.5" />
              <span>
                Agent ID <code>#{agentId.toString()}</code> is not registered on the ERC-8004 Identity Registry yet.
                Per ADR 0017, user protection mandates are restricted to registered agents with verifiable on-chain track records.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-md border border-[var(--border)] p-2.5 bg-[var(--bg-elevated)] space-y-1">
              <span className="text-[11px] text-[var(--text-tertiary)] block">
                Identity Registry
              </span>
              <a
                href={`${explorerBase}/address/${identityRegistry}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[var(--brand)] hover:underline inline-flex items-center gap-1"
              >
                {shortenAddress(identityRegistry ?? "")}
                <ExternalLink className="size-3" />
              </a>
            </div>

            <div className="rounded-md border border-[var(--border)] p-2.5 bg-[var(--bg-elevated)] space-y-1">
              <span className="text-[11px] text-[var(--text-tertiary)] block">
                Reputation Registry
              </span>
              <a
                href={`${explorerBase}/address/${reputationRegistry}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[var(--brand)] hover:underline inline-flex items-center gap-1"
              >
                {shortenAddress(reputationRegistry ?? "")}
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className} data-testid="agent-card-registered">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-md p-1.5 bg-[var(--brand-bg)] border border-[var(--brand-glow)]">
              <ShieldCheck className="size-5 text-[var(--brand)]" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                {agentName}
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-tertiary)]">
                Agent ID #{agentId.toString()} · ERC-8004 Trustless Agent
              </CardDescription>
            </div>
          </div>
          <Badge variant="safe" size="sm" dot>
            Verified Identity
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-1">
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {agentDesc}
        </p>

        {/* Identity & Strategy Details */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5 space-y-1">
            <span className="text-[11px] text-[var(--text-tertiary)] block">Owner</span>
            {owner ? (
              <a
                href={`${explorerBase}/address/${owner}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[var(--brand)] hover:underline inline-flex items-center gap-1"
              >
                {shortenAddress(owner)}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="text-[var(--text-tertiary)]">—</span>
            )}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5 space-y-1">
            <span className="text-[11px] text-[var(--text-tertiary)] block">Agent Wallet</span>
            {agentWallet ? (
              <a
                href={`${explorerBase}/address/${agentWallet}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[var(--brand)] hover:underline inline-flex items-center gap-1"
              >
                {shortenAddress(agentWallet)}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="text-[var(--text-tertiary)]">—</span>
            )}
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5 space-y-1">
            <span className="text-[11px] text-[var(--text-tertiary)] block">Strategy Version</span>
            <span className="font-mono text-[var(--text-primary)] font-medium">
              {strategyVersion}
            </span>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-2.5 space-y-1">
            <span className="text-[11px] text-[var(--text-tertiary)] block">Reputation Score</span>
            <div className="flex items-center gap-1.5">
              <Award className="size-3.5 text-[var(--accent2)]" />
              <span className="font-mono text-[var(--text-primary)] font-semibold">
                {reputation.count > 0n
                  ? `${reputation.summaryValue.toString()}`
                  : "New"}
              </span>
            </div>
          </div>
        </div>

        {/* Reputation & Sybil Filter Breakdown */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[var(--text-primary)]">
              Sybil-Filtered Reputation (ADR 0017)
            </span>
            <Badge variant="brand" size="sm">
              {reputation.verifiedClientsCount} of {reputation.totalClients} clients verified
            </Badge>
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] leading-normal">
            Only feedback submitted by addresses holding a verified policy on our Guardians is counted in the reputation score.
          </p>
        </div>

        {/* Off-chain Links */}
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
          <a
            href="/scorecard"
            className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
          >
            <Award className="size-3.5" />
            Public Scorecard
          </a>
          <a
            href="/.well-known/agent-registration.json"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <FileJson className="size-3.5" />
            Registration File
          </a>
          {agentURI && (
            <a
              href={`${explorerBase}/token/${identityRegistry}?a=${agentId.toString()}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <ExternalLink className="size-3.5" />
              View on Arbiscan
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

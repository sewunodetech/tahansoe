"use client";

import React from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import { formatToken, formatUsd } from "@/components/dashboard/live/live-shared";
import type { HoldingRow } from "@/lib/holdings";

export interface HoldingsTableProps {
  items: HoldingRow[];
  explorerAddress: (address: string) => string | null;
}

function formatAllowanceDisplay(allowance: bigint | null, decimals: number, symbol: string): string {
  if (allowance === null) return "—";
  if (allowance === 0n) return "0.00";
  if (allowance > 10n ** 30n) return "Unlimited";
  return `${formatToken(allowance, decimals)} ${symbol}`;
}

export function HoldingsTable({ items, explorerAddress }: HoldingsTableProps) {
  return (
    <Card className="border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden">
      <CardHeader className="pb-3 border-b border-[var(--border)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-[var(--text-primary)]">
              Wallet Tokens & Guardian Allowances
            </CardTitle>
            <CardDescription className="text-xs text-[var(--text-secondary)] mt-0.5">
              Tokens detected in the active chain registry. Layer 1 can only draw funds from tokens with an active allowance.
            </CardDescription>
          </div>
          <span className="text-[11px] font-mono text-[var(--text-tertiary)] self-start sm:self-center">
            {items.length} assets
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-subtle)] text-[11px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
                <th className="py-3 px-4 sm:px-6">Asset</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-right">Value (USD)</th>
                <th className="py-3 px-4 text-right">Guardian Allowance</th>
                <th className="py-3 px-4 sm:px-6 text-center">Layer 1 Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-xs font-mono">
              {items.map((token) => {
                const isNative = token.address === "native";
                const explorerUrl = !isNative ? explorerAddress(token.address) : null;

                return (
                  <tr
                    key={token.symbol + token.address}
                    className={`transition-colors hover:bg-[var(--bg-subtle)] ${
                      token.usedByLayer1 ? "bg-[var(--brand-bg)]/20" : ""
                    }`}
                  >
                    {/* Asset column */}
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="flex items-center gap-2.5">
                        <div className="size-8 rounded-full bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center font-sans font-bold text-xs text-[var(--text-primary)] shrink-0">
                          {token.symbol.slice(0, 3)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm font-sans text-[var(--text-primary)]">
                              {token.symbol}
                            </span>
                            {token.usedByLayer1 && (
                              <LayerBadge layer={1} size="sm" />
                            )}
                          </div>
                          <div className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5">
                            {isNative ? (
                              <span>Native Gas Token</span>
                            ) : explorerUrl ? (
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 hover:text-[var(--brand)] hover:underline"
                              >
                                {token.address.slice(0, 6)}…{token.address.slice(-4)}
                                <ExternalLink className="size-2.5" />
                              </a>
                            ) : (
                              <span>{token.address.slice(0, 6)}…{token.address.slice(-4)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Balance */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="text-[var(--text-primary)] font-medium">
                        {formatToken(token.balance, token.decimals, token.decimals > 8 ? 4 : 2)}
                      </div>
                      <div className="text-[10px] text-[var(--text-tertiary)]">
                        {token.symbol}
                      </div>
                    </td>

                    {/* Value USD */}
                    <td className="py-3.5 px-4 text-right">
                      {token.valueUsd !== null ? (
                        <div className="text-[var(--text-primary)] font-medium">
                          {formatUsd(token.valueUsd)}
                        </div>
                      ) : (
                        <span className="text-[var(--text-tertiary)]" title="No Aave oracle price available">
                          —
                        </span>
                      )}
                    </td>

                    {/* Allowance */}
                    <td className="py-3.5 px-4 text-right">
                      {isNative ? (
                        <span className="text-[var(--text-tertiary)] text-[11px]">
                          Native token
                        </span>
                      ) : (
                        <div>
                          <div
                            className={
                              token.allowanceToGuardian && token.allowanceToGuardian > 0n
                                ? "text-[var(--safe)] font-medium"
                                : "text-[var(--text-tertiary)]"
                            }
                          >
                            {formatAllowanceDisplay(
                              token.allowanceToGuardian,
                              token.decimals,
                              token.symbol
                            )}
                          </div>
                          {token.allowanceToGuardian === 0n && (
                            <span className="text-[10px] text-[var(--text-tertiary)]">
                              Not approved
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Layer 1 Status */}
                    <td className="py-3.5 px-4 sm:px-6 text-center">
                      {token.usedByLayer1 ? (
                        <Badge variant="safe" size="sm" dot>
                          Used by Layer 1
                        </Badge>
                      ) : (
                        <span className="text-[var(--text-tertiary)] text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-[var(--text-tertiary)]">
                    No registry tokens detected for this chain.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

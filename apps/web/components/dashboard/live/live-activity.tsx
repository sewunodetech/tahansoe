"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { GUARDIAN, LEGACY_GUARDIANS, LIVE_CHAIN, debtAssetSymbol, explorerTx, guardianAbi } from "@/lib/contracts";
import { wadToNumber } from "@tahansoe/domain";

interface ActivityRow {
  key: string;
  block: bigint;
  hash: string;
  version: number;
  label: string;
  detail: string;
}

/** Guardian events for the connected wallet across every Guardian version, newest first. */
export function LiveActivity() {
  const { address: user } = useAccount();
  const client = usePublicClient({ chainId: LIVE_CHAIN.id });

  const { data, isLoading, error } = useQuery({
    queryKey: ["guardian-activity", user],
    enabled: Boolean(user && client),
    refetchInterval: 30_000,
    queryFn: async (): Promise<ActivityRow[]> => {
      const rows: ActivityRow[] = [];
      for (const g of [GUARDIAN, ...LEGACY_GUARDIANS]) {
        const base = { address: g.address, abi: guardianAbi, fromBlock: BigInt(g.deployedBlock), args: { user: user! } };
        const [set, disabled, protectedLogs] = await Promise.all([
          client!.getContractEvents({ ...base, eventName: "PolicySet" }),
          client!.getContractEvents({ ...base, eventName: "PolicyDisabled" }),
          client!.getContractEvents({ ...base, eventName: "Protected" }),
        ]);
        for (const log of set) {
          rows.push({
            key: `${log.transactionHash}-${log.logIndex}`,
            block: log.blockNumber,
            hash: log.transactionHash,
            version: g.version,
            label: "Policy saved",
            detail: `${debtAssetSymbol(log.args.debtAsset)} · trigger ${wadToNumber(log.args.triggerHF!).toFixed(2)} → target ${wadToNumber(log.args.targetHF!).toFixed(2)}`,
          });
        }
        for (const log of disabled) {
          rows.push({
            key: `${log.transactionHash}-${log.logIndex}`,
            block: log.blockNumber,
            hash: log.transactionHash,
            version: g.version,
            label: "Policy disabled",
            detail: "Tahansoe stopped acting on this wallet",
          });
        }
        for (const log of protectedLogs) {
          rows.push({
            key: `${log.transactionHash}-${log.logIndex}`,
            block: log.blockNumber,
            hash: log.transactionHash,
            version: g.version,
            label: "Debt repaid",
            detail: `HF ${wadToNumber(log.args.healthFactorBefore!).toFixed(2)} → ${wadToNumber(log.args.healthFactorAfter!).toFixed(2)} · ${debtAssetSymbol(log.args.debtAsset)}`,
          });
        }
      }
      return rows.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1));
    },
  });

  if (isLoading) {
    return (
      <Card className="p-6 flex items-center gap-2 text-xs font-mono text-[var(--text-tertiary)]">
        <Loader2 className="size-4 animate-spin" /> Reading Guardian events…
      </Card>
    );
  }
  if (error) {
    return <Card className="p-6 text-xs font-mono text-[var(--danger)]">{error.message.split("\n")[0]}</Card>;
  }
  if (!data?.length) {
    return (
      <Card className="p-6 text-xs text-[var(--text-tertiary)]">
        No Guardian activity for this wallet yet. Saving a policy or a repay by the Guardian shows up here.
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-[var(--border)]">
      {data.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-4 px-5 py-3.5">
          <div>
            <p className="text-sm text-[var(--text-primary)]">{row.label}</p>
            <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-0.5">
              {row.detail} · Guardian v{row.version} · block {row.block.toString()}
            </p>
          </div>
          <a
            href={explorerTx(row.hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[11px] font-mono text-[var(--brand)] hover:underline shrink-0"
          >
            {row.hash.slice(0, 8)}… <ArrowUpRight className="size-3" />
          </a>
        </div>
      ))}
    </Card>
  );
}

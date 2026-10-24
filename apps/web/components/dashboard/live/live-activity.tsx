"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { guardianAbi, guardianV2Abi } from "@/lib/contracts";
import { assetSymbol, useLiveTarget } from "@/lib/live-target";
import { isGuardianV2, wadToNumber } from "@tahansoe/domain";

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
  const target = useLiveTarget();
  const client = usePublicClient({ chainId: target.chain.id });
  const debtAssetSymbol = (address: string | undefined) => assetSymbol(target, address);

  const { data, isLoading, error } = useQuery({
    queryKey: ["guardian-activity", user, target.chain.id, target.guardian.address],
    enabled: Boolean(user && client && target.ready),
    refetchInterval: 30_000,
    queryFn: async (): Promise<ActivityRow[]> => {
      const rows: ActivityRow[] = [];
      // The simulation RPC proxy caps eth_getLogs at 10,000 blocks (spec m1-simulation-mode §3.7).
      const simFloor = target.isSimulation ? (await client!.getBlockNumber()) - 9_000n : 0n;
      for (const g of [target.guardian, ...target.legacyGuardians]) {
        const isV2 = isGuardianV2(g);
        const abi = isV2 ? guardianV2Abi : guardianAbi;
        const base = { address: g.address, abi, fromBlock: BigInt(g.deployedBlock) > simFloor ? BigInt(g.deployedBlock) : simFloor > 0n ? simFloor : 0n, args: { user: user! } };

        if (isV2) {
          const [set, disabled, protectedLogs, l2Set, l3Set, tbSet, dynSet, layerUsed] = await Promise.all([
            client!.getContractEvents({ ...base, eventName: "PolicySet" as const }),
            client!.getContractEvents({ ...base, eventName: "PolicyDisabled" as const }),
            client!.getContractEvents({ ...base, eventName: "Protected" as const }),
            client!.getContractEvents({ ...base, eventName: "Layer2Set" as const }),
            client!.getContractEvents({ ...base, eventName: "Layer3Set" as const }),
            client!.getContractEvents({ ...base, eventName: "TriggerBandSet" as const }),
            client!.getContractEvents({ ...base, eventName: "DynamicTriggerSet" as const }),
            client!.getContractEvents({ ...base, eventName: "LayerUsed" as const }),
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
          for (const log of l2Set) {
            const kind = log.args.kind ?? 0;
            const kindName = kind === 1 ? "ERC-4626 Vault" : kind === 2 ? "aToken Reserve" : "None";
            rows.push({
              key: `${log.transactionHash}-${log.logIndex}`,
              block: log.blockNumber,
              hash: log.transactionHash,
              version: g.version,
              label: "Layer 2 configured",
              detail: kind === 0 ? "Disabled" : `${kindName} · ${log.args.source?.slice(0, 6)}…${log.args.source?.slice(-4)}`,
            });
          }
          for (const log of l3Set) {
            rows.push({
              key: `${log.transactionHash}-${log.logIndex}`,
              block: log.blockNumber,
              hash: log.transactionHash,
              version: g.version,
              label: "Layer 3 configured",
              detail: log.args.enabled
                ? `Collateral ${debtAssetSymbol(log.args.collateralAsset)} · max slippage ${(Number(log.args.maxSlippageBps ?? 0) / 100).toFixed(2)}%`
                : "Disabled",
            });
          }
          for (const log of tbSet) {
            rows.push({
              key: `${log.transactionHash}-${log.logIndex}`,
              block: log.blockNumber,
              hash: log.transactionHash,
              version: g.version,
              label: "Trigger band configured",
              detail: `Band ${wadToNumber(log.args.minTriggerHF!).toFixed(2)} - ${wadToNumber(log.args.maxTriggerHF!).toFixed(2)} · agent ${log.args.riskAgent?.slice(0, 6)}…${log.args.riskAgent?.slice(-4)}`,
            });
          }
          for (const log of dynSet) {
            rows.push({
              key: `${log.transactionHash}-${log.logIndex}`,
              block: log.blockNumber,
              hash: log.transactionHash,
              version: g.version,
              label: "Dynamic trigger updated",
              detail: `Trigger set to ${wadToNumber(log.args.triggerHF!).toFixed(2)} by AI agent`,
            });
          }
          for (const log of layerUsed) {
            rows.push({
              key: `${log.transactionHash}-${log.logIndex}`,
              block: log.blockNumber,
              hash: log.transactionHash,
              version: g.version,
              label: `Layer ${log.args.layer} executed`,
              detail: `Repaid debt via Layer ${log.args.layer}`,
            });
          }
        } else {
          const [set, disabled, protectedLogs] = await Promise.all([
            client!.getContractEvents({ ...base, eventName: "PolicySet" as const }),
            client!.getContractEvents({ ...base, eventName: "PolicyDisabled" as const }),
            client!.getContractEvents({ ...base, eventName: "Protected" as const }),
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
          {target.explorerTx(row.hash) ? (
            <a
              href={target.explorerTx(row.hash)!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] font-mono text-[var(--brand)] hover:underline shrink-0"
            >
              {row.hash.slice(0, 8)}… <ArrowUpRight className="size-3" />
            </a>
          ) : (
            <span className="text-[11px] font-mono text-[var(--text-tertiary)] shrink-0">{row.hash.slice(0, 8)}…</span>
          )}
        </div>
      ))}
    </Card>
  );
}

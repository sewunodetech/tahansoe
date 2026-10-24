"use client";

import React, { useState } from "react";
import { erc20Abi, parseEther, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Wand2 } from "lucide-react";
import { baseToToken, hfToWad, recommendedRepayBase, validatePolicy, wadToNumber } from "@tahansoe/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LayerBadge } from "@/components/ui/layer-badge";
import { aaveOracleAbi, aavePoolAbi, guardianV2Abi } from "@/lib/contracts";
import { useLiveTarget } from "@/lib/live-target";
import { aavePoolWriteAbi, wethAbi } from "@/lib/sim/abis";
import { useSimActions } from "@/lib/sim/hooks";
import { useSimDashboard } from "./sim-context";

/** Sample position for Auto-fill (spec m1-simulation-mode §3.5): 2 ETH collateral, HF about 1.4, so a 30% drop liquidates it without protection. */
const SAMPLE = { supplyEth: "2", borrowHf: 1.4, triggerHf: 1.25, targetHf: 1.55, l3MaxEth: "0.5", l3SlippageBps: 50 };
/** Cap per action × this = allowance, leaving room for a few actions plus the 0.15% success fee. */
const ALLOWANCE_ACTIONS = 3n;
const BASE_UNIT = 100_000_000;

type StepId = "supply" | "borrow" | "protect";

const STEPS: { id: StepId; title: string; detail: string }[] = [
  { id: "supply", title: "Supply WETH", detail: "Wrap ETH, approve the Aave pool, supply as collateral" },
  { id: "borrow", title: "Borrow USDC", detail: "Variable-rate USDC loan against your WETH" },
  { id: "protect", title: "Set protection", detail: "Approve a capped amount, setPolicy, and Layer 3" },
];

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err && typeof err.shortMessage === "string") return err.shortMessage;
  return err instanceof Error ? err.message.split("\n")[0] : "Transaction failed";
}

/** Opens a position on the fork and protects it, step by step or all at once. */
export function SimSetupWizard() {
  const target = useLiveTarget();
  const { address: user } = useAccount();
  const client = usePublicClient({ chainId: target.chain.id });
  const { mutateAsync: writeContract } = useWriteContract();
  const queryClient = useQueryClient();
  const { addTx, setBaseline } = useSimDashboard();
  const { markPositionOpened } = useSimActions();

  const [supplyEth, setSupplyEth] = useState(SAMPLE.supplyEth);
  const [borrowUsdc, setBorrowUsdc] = useState("");
  const [triggerHf, setTriggerHf] = useState(String(SAMPLE.triggerHf));
  const [targetHf, setTargetHf] = useState(String(SAMPLE.targetHf));
  const [layer3, setLayer3] = useState(true);
  const [done, setDone] = useState<Record<StepId, boolean>>({ supply: false, borrow: false, protect: false });
  const [running, setRunning] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usdc = target.debtAssets.find((a) => a.symbol === "USDC")!;
  const policyError = validatePolicy({ triggerHf: Number(triggerHf), targetHf: Number(targetHf), maxRepayPerAction: 1n });

  const readAccount = async () => {
    const [collateralBase, debtBase, , lt, , hf] = await client!.readContract({
      address: target.pool,
      abi: aavePoolAbi,
      functionName: "getUserAccountData",
      args: [user!],
    });
    return { collateralBase, debtBase, lt, hf: debtBase === 0n ? null : wadToNumber(hf) };
  };

  /**
   * Sends one tx with the burner, waits for it, and logs HF before → after. Gas gets a 30% margin:
   * the price relay writes between estimate and execution, and a bare estimate ran Aave's borrow out of gas.
   */
  const send = async (action: string, request: Parameters<typeof writeContract>[0]) => {
    setCurrent(action);
    const before = (await readAccount()).hf;
    const pc = client!;
    const estimate = await pc.estimateContractGas({ ...(request as Parameters<typeof pc.estimateContractGas>[0]), account: user! });
    const hash = await writeContract({ ...request, gas: (estimate * 13n) / 10n });
    const receipt = await client!.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${action} reverted`);
    const after = (await readAccount()).hf;
    addTx({ hash, action, hfBefore: before, hfAfter: after, at: Date.now() });
  };

  const supply = async (amountEth: string) => {
    const amount = parseEther(amountEth);
    // The shared request type is not narrowed by `abi`, so the payable `value` needs a cast.
    const wrap = { chainId: target.chain.id, address: target.weth, abi: wethAbi, functionName: "deposit", value: amount };
    await send("Wrap ETH", wrap as unknown as Parameters<typeof writeContract>[0]);
    await send("Approve WETH → Aave", {
      chainId: target.chain.id,
      address: target.weth,
      abi: erc20Abi,
      functionName: "approve",
      args: [target.pool, amount],
    });
    await send("Supply WETH", {
      chainId: target.chain.id,
      address: target.pool,
      abi: aavePoolWriteAbi,
      functionName: "supply",
      args: [target.weth, amount, user!, 0],
    });
  };

  /** Borrows `amountUsdc`, or enough to land at HF `hf` when empty. */
  const borrow = async (amountUsdc: string, hf: number) => {
    let amount: bigint;
    if (amountUsdc) {
      amount = BigInt(Math.floor(Number(amountUsdc) * 1e6));
    } else {
      const acct = await readAccount();
      const wantDebtBase = (acct.collateralBase * acct.lt * 1000n) / (10_000n * BigInt(Math.round(hf * 1000)));
      const extraBase = wantDebtBase > acct.debtBase ? wantDebtBase - acct.debtBase : 0n;
      const price = await client!.readContract({ address: target.oracle, abi: aaveOracleAbi, functionName: "getAssetPrice", args: [usdc.address] });
      amount = baseToToken(extraBase, price, usdc.decimals);
    }
    if (amount <= 0n) throw new Error("Nothing to borrow: supply collateral first.");
    await send("Borrow USDC", {
      chainId: target.chain.id,
      address: target.pool,
      abi: aavePoolWriteAbi,
      functionName: "borrow",
      args: [usdc.address, amount, 2n, 0, user!],
    });
    await markPositionOpened();
  };

  const protect = async (trigger: number, targetH: number, withL3: boolean) => {
    const acct = await readAccount();
    const price = await client!.readContract({ address: target.oracle, abi: aaveOracleAbi, functionName: "getAssetPrice", args: [usdc.address] });
    const maxRepay = baseToToken(recommendedRepayBase(acct.debtBase, hfToWad(trigger), hfToWad(targetH)), price, usdc.decimals);
    if (maxRepay <= 0n) throw new Error("Open a borrow first so the Guardian has something to protect.");
    const allowance = maxRepay * ALLOWANCE_ACTIONS + (maxRepay * ALLOWANCE_ACTIONS * 15n) / 10_000n;

    await send("Approve USDC → Guardian", {
      chainId: target.chain.id,
      address: usdc.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [target.guardian.address, allowance],
    });
    await send("setPolicy", {
      chainId: target.chain.id,
      address: target.guardian.address,
      abi: guardianV2Abi,
      functionName: "setPolicy",
      args: [usdc.address, hfToWad(trigger), hfToWad(targetH), maxRepay],
    });

    if (withL3) {
      const reserve = await client!.readContract({ address: target.pool, abi: aavePoolAbi, functionName: "getReserveData", args: [target.weth] });
      const maxCollateral = parseEther(SAMPLE.l3MaxEth);
      await send("Approve aWETH → Guardian", {
        chainId: target.chain.id,
        address: reserve.aTokenAddress as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [target.guardian.address, maxCollateral * ALLOWANCE_ACTIONS],
      });
      await send("setLayer3", {
        chainId: target.chain.id,
        address: target.guardian.address,
        abi: guardianV2Abi,
        functionName: "setLayer3",
        args: [true, target.weth, maxCollateral, SAMPLE.l3SlippageBps],
      });
    }

    const after = await readAccount();
    const ethPrice = await client!.readContract({ address: target.oracle, abi: aaveOracleAbi, functionName: "getAssetPrice", args: [target.weth] });
    setBaseline({
      collateralEth: Number(after.collateralBase) / Number(ethPrice),
      debtUsd: Number(after.debtBase) / BASE_UNIT,
      liquidationThreshold: Number(after.lt) / 10_000,
      triggerHf: trigger,
    });
  };

  const run = async (key: string, fn: () => Promise<void>, mark: StepId[]) => {
    if (!user || !client) return;
    setError(null);
    setRunning(key);
    try {
      await fn();
      setDone((d) => ({ ...d, ...Object.fromEntries(mark.map((m) => [m, true])) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(null);
      setCurrent(null);
      await queryClient.invalidateQueries();
    }
  };

  const autoFill = () =>
    run(
      "auto",
      async () => {
        await supply(SAMPLE.supplyEth);
        setDone((d) => ({ ...d, supply: true }));
        await borrow("", SAMPLE.borrowHf);
        setDone((d) => ({ ...d, borrow: true }));
        await protect(SAMPLE.triggerHf, SAMPLE.targetHf, true);
      },
      ["supply", "borrow", "protect"]
    );

  const disabled = running !== null || !target.ready || !user;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Open a sample position</CardTitle>
            <CardDescription className="text-xs mt-1 max-w-[460px]">
              One click supplies 2 ETH, borrows USDC down to HF ≈ 1.4, and turns on protection. These are real transactions on the fork, signed by your simulation wallet.
            </CardDescription>
          </div>
          <Button size="sm" onClick={autoFill} disabled={disabled}>
            {running === "auto" ? <Loader2 className="animate-spin" /> : <Wand2 />} Auto-fill
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {STEPS.map((step) => (
            <span
              key={step.id}
              className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[11px] ${
                done[step.id] ? "border-[var(--safe-border)] text-[var(--safe)] bg-[var(--safe-bg)]" : "border-[var(--border)] text-[var(--text-tertiary)]"
              }`}
            >
              {done[step.id] ? <CheckCircle2 className="size-3" /> : <Circle className="size-3" />} {step.title}
            </span>
          ))}
        </div>

        <details className="group rounded-md border border-[var(--border)]">
          <summary className="cursor-pointer list-none px-3.5 py-2.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] select-none">
            <span className="group-open:hidden">Prefer to do it step by step? Choose your own amounts and HF</span>
            <span className="hidden group-open:inline">Step by step</span>
          </summary>
          <div className="space-y-3 p-3 pt-0">
        {STEPS.map((step, i) => (
          <div key={step.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3.5 space-y-3">
            <div className="flex items-start gap-2.5">
              {done[step.id] ? (
                <CheckCircle2 className="size-4 text-[var(--safe)] shrink-0 mt-0.5" />
              ) : (
                <Circle className="size-4 text-[var(--text-disabled)] shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)]">
                  {i + 1}. {step.title}
                </p>
                <p className="text-[11px] text-[var(--text-tertiary)]">{step.detail}</p>
              </div>
            </div>

            {step.id === "supply" && (
              <div className="flex flex-col sm:flex-row gap-2">
                <Input value={supplyEth} onChange={(e) => setSupplyEth(e.target.value)} inputMode="decimal" aria-label="ETH to supply" className="sm:max-w-[160px]" />
                <Button size="sm" variant="secondary" disabled={disabled || !(Number(supplyEth) > 0)} onClick={() => run("supply", () => supply(supplyEth), ["supply"])}>
                  Supply {supplyEth || "0"} ETH
                </Button>
              </div>
            )}

            {step.id === "borrow" && (
              <div className="flex flex-col sm:flex-row gap-2">
                <Input value={borrowUsdc} onChange={(e) => setBorrowUsdc(e.target.value)} inputMode="decimal" placeholder="Auto: HF 1.4" aria-label="USDC to borrow" className="sm:max-w-[160px]" />
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => run("borrow", () => borrow(borrowUsdc, SAMPLE.borrowHf), ["borrow"])}>
                  Borrow {borrowUsdc ? `${borrowUsdc} USDC` : "to HF 1.4"}
                </Button>
              </div>
            )}

            {step.id === "protect" && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
                    <span>Trigger HF</span>
                    <Input value={triggerHf} onChange={(e) => setTriggerHf(e.target.value)} inputMode="decimal" />
                  </label>
                  <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
                    <span>Target HF</span>
                    <Input value={targetHf} onChange={(e) => setTargetHf(e.target.value)} inputMode="decimal" />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  <LayerBadge layer={1} /> wallet reserve (USDC)
                  <button
                    type="button"
                    role="switch"
                    aria-checked={layer3}
                    onClick={() => setLayer3((v) => !v)}
                    className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full border transition-colors cursor-pointer ${
                      layer3 ? "border-[var(--brand)] text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-tertiary)]"
                    }`}
                  >
                    <LayerBadge layer={3} /> flash deleverage {layer3 ? "on" : "off"}
                  </button>
                </div>
                {policyError && <p className="text-[11px] text-[var(--danger)]">{policyError}</p>}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || policyError !== null}
                  onClick={() => run("protect", () => protect(Number(triggerHf), Number(targetHf), layer3), ["protect"])}
                >
                  Approve + setPolicy
                </Button>
              </div>
            )}
          </div>
        ))}
          </div>
        </details>

        {running && (
          <p className="text-[11px] font-mono text-[var(--text-tertiary)] flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> {running === "auto" ? "Auto-fill: " : ""}{current ?? "Preparing"}…
          </p>
        )}
        {error && (
          <p role="alert" className="text-[11px] text-[var(--danger)] break-words">
            {error}
          </p>
        )}
        {!target.ready && (
          <p className="text-[11px] text-[var(--text-tertiary)]">Waiting for the simulation chain. With the mock simnet, transactions are disabled.</p>
        )}
      </CardContent>
    </Card>
  );
}

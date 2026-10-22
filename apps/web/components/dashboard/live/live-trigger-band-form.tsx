"use client";

import React, { useState } from "react";
import { isAddress, type Address } from "viem";
import { Bot, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { UseGuardianReturn } from "@/hooks/useGuardian";
import { TxStatus } from "./live-shared";

export function LiveTriggerBandForm({ g }: { g: UseGuardianReturn }) {
  const existing = g.triggerBand;

  const [minHf, setMinHf] = useState<number>(existing?.minTriggerHf ?? 1.2);
  const [maxHf, setMaxHf] = useState<number>(existing?.maxTriggerHf ?? 1.5);
  const [agent, setAgent] = useState<string>(
    existing?.riskAgent && existing.riskAgent !== "0x0000000000000000000000000000000000000000"
      ? existing.riskAgent
      : ""
  );

  const isValidAgent = isAddress(agent);
  const busy = g.tx.step !== null;
  const [now] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  const hasActiveDynamic =
    existing &&
    existing.dynamicTriggerHf > 0 &&
    existing.validUntil > now;

  const saved =
    existing !== null &&
    existing.minTriggerHf === minHf &&
    existing.maxTriggerHf === maxHf &&
    existing.riskAgent.toLowerCase() === agent.toLowerCase();

  const handleSave = () => {
    if (!isValidAgent || minHf >= maxHf) return;
    g.actions.setTriggerBand(minHf, maxHf, agent as Address);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--brand)]">
            <Bot className="size-4" /> AI Risk Agent Band
          </div>
          {existing && existing.riskAgent !== "0x0000000000000000000000000000000000000000" && (
            <span className="text-[11px] font-mono text-[var(--safe)] inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5" /> Band active
            </span>
          )}
        </div>
        <CardTitle className="text-sm mt-3">Dynamic Trigger Band</CardTitle>
        <CardDescription className="text-xs">
          Authorize Tahansoe&apos;s off-chain AI Risk Engine to preemptively raise your trigger within a bounded range during high volatility.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasActiveDynamic && existing && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-xs">
            <Clock className="size-4 text-[var(--brand)] shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-[var(--text-primary)]">
                Dynamic Trigger Active: {existing.dynamicTriggerHf.toFixed(2)}
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                Valid for {Math.max(0, Number(existing.validUntil - now))} more seconds
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-[var(--text-secondary)]">Min Trigger HF</label>
            <Input
              type="number"
              step="0.05"
              value={minHf}
              onChange={(e) => setMinHf(Number(e.target.value))}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-[var(--text-secondary)]">Max Trigger HF</label>
            <Input
              type="number"
              step="0.05"
              value={maxHf}
              onChange={(e) => setMaxHf(Number(e.target.value))}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-secondary)]">Authorized Risk Agent Address</label>
          <Input
            placeholder="0x..."
            value={agent}
            onChange={(e) => setAgent(e.target.value.trim())}
            className="font-mono text-xs"
          />
          {!isValidAgent && agent.length > 0 && (
            <p className="text-[11px] text-[var(--danger)]">Enter a valid agent address</p>
          )}
        </div>

        <Button
          variant="default"
          size="sm"
          className="w-full"
          disabled={busy || !isValidAgent || minHf >= maxHf || saved}
          onClick={handleSave}
        >
          {saved ? "Band Saved" : "Set Trigger Band"}
        </Button>

        <TxStatus tx={g.tx} steps={["setTriggerBand"]} />
      </CardContent>
    </Card>
  );
}

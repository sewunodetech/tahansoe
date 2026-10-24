"use client";

import React from "react";
import {
  Bell,
  BellOff,
  AlertTriangle,
  Zap,
  CheckCircle,
  ShieldCheck,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { PolicySettings } from "@/lib/simulation-context";

interface NotificationPrefsCardProps {
  policy: PolicySettings;
  telegramEnabled: boolean;
  onToggleMaster: (enabled: boolean) => void;
  onUpdatePolicy: (patch: Partial<PolicySettings>) => void;
}

type NotifDef = {
  key: keyof Pick<
    PolicySettings,
    | "notifHfWarning"
    | "notifTriggerFired"
    | "notifExecSuccess"
    | "notifExecFailed"
    | "notifPositionSafe"
  >;
  label: string;
  description: string;
  icon: import("lucide-react").LucideIcon;
  iconClass: string;
};

const NOTIF_DEFS: NotifDef[] = [
  {
    key: "notifHfWarning",
    label: "Health Factor Warning Margin",
    description:
      "Alert when HF enters the warning buffer (trigger + 0.15), an early warning before the Guardian acts.",
    icon: AlertTriangle,
    iconClass: "text-[var(--warning)]",
  },
  {
    key: "notifTriggerFired",
    label: "Deterministic Trigger Fired",
    description:
      "Instant push when Tahansoe detects HF ≤ trigger threshold and begins automated remediation cascade.",
    icon: Zap,
    iconClass: "text-[var(--danger)]",
  },
  {
    key: "notifExecSuccess",
    label: "Repayment & Remediation Succeeded",
    description:
      "Execution confirmation detailing the layer used (L1/L2/L3), repay amount, gas fee, and before/after HF.",
    icon: CheckCircle,
    iconClass: "text-[var(--safe)]",
  },
  {
    key: "notifExecFailed",
    label: "Execution Reverted / Failed",
    description:
      "Urgent alert if a transaction reverts due to slippage limits, network congestion, or flash loan liquidity.",
    icon: AlertTriangle,
    iconClass: "text-[var(--danger)]",
  },
  {
    key: "notifPositionSafe",
    label: "Position Restored to Safe Zone",
    description:
      "Resolution update confirming position HF has successfully returned above target threshold.",
    icon: ShieldCheck,
    iconClass: "text-[var(--safe)]",
  },
];

export function NotificationPrefsCard({
  policy,
  telegramEnabled,
  onToggleMaster,
  onUpdatePolicy,
}: NotificationPrefsCardProps) {
  return (
    <Card>
      <CardHeader className="border-b border-[var(--border)] flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Notification Preferences</CardTitle>
          <CardDescription>
            Select which telemetry and execution events dispatch mobile Telegram alerts
          </CardDescription>
        </div>

        <Button
          variant={telegramEnabled ? "secondary" : "outline"}
          size="sm"
          onClick={() => onToggleMaster(!telegramEnabled)}
          className="gap-1.5 text-xs font-mono"
        >
          {telegramEnabled ? (
            <>
              <Bell className="size-3.5 text-[var(--safe)]" /> Alerts Active
            </>
          ) : (
            <>
              <BellOff className="size-3.5 text-[var(--text-tertiary)]" /> Alerts Paused
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="divide-y divide-[var(--border)] p-5 pt-0">
        {NOTIF_DEFS.map((def) => {
          const Icon = def.icon;
          const isChecked = policy[def.key] ?? false;

          return (
            <div
              key={def.key}
              className="flex items-start justify-between gap-4 py-4 first:pt-4"
            >
              <div className="flex items-start gap-3">
                <div className="size-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className={`size-4 ${def.iconClass}`} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    {def.label}
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 max-w-md leading-relaxed">
                    {def.description}
                  </p>
                </div>
              </div>

              <Switch
                checked={isChecked && telegramEnabled}
                disabled={!telegramEnabled}
                onCheckedChange={(v) => onUpdatePolicy({ [def.key]: v })}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

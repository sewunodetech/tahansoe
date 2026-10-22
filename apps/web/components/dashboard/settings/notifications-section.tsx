"use client";

import React from "react";
import { Bell, MessageSquare, Smartphone } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { PolicySettings } from "@/lib/simulation-context";
import { TELEGRAM_BOT_USERNAME } from "@/lib/telegram";

interface NotificationsSectionProps {
  policy: PolicySettings;
  telegramEnabled: boolean;
  onToggleTelegram: (enabled: boolean) => void;
  onUpdatePolicy: (patch: Partial<PolicySettings>) => void;
}

export function NotificationsSection({
  policy,
  telegramEnabled,
  onToggleTelegram,
  onUpdatePolicy,
}: NotificationsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notification Channels</CardTitle>
        <CardDescription>
          Configure where and when Tahansoe broadcasts health factor alerts
        </CardDescription>
      </CardHeader>

      <CardContent className="divide-y divide-[var(--border)]">
        <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0">
          <div className="flex items-start gap-3">
            <div className="size-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0 mt-0.5">
              <MessageSquare className="size-4 text-[var(--brand)]" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">In-App Dashboard Alerts</p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                Display banner and toast alerts in the dashboard when health factor drops into the warning zone.
              </p>
            </div>
          </div>
          <Switch
            checked={policy.alertsEnabled}
            onCheckedChange={(checked) => onUpdatePolicy({ alertsEnabled: checked })}
          />
        </div>

        <div className="flex items-center justify-between gap-4 py-3.5">
          <div className="flex items-start gap-3">
            <div className="size-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0 mt-0.5">
              <Smartphone className="size-4 text-[var(--brand)]" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Telegram Push Bridge (@{TELEGRAM_BOT_USERNAME})
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                Relay critical alerts, early warning notices, and repayment executions to your mobile Telegram chat.
              </p>
            </div>
          </div>
          <Switch checked={telegramEnabled} onCheckedChange={onToggleTelegram} />
        </div>

        <div className="flex items-center justify-between gap-4 py-3.5 last:pb-0">
          <div className="flex items-start gap-3">
            <div className="size-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0 mt-0.5">
              <Bell className="size-4 text-[var(--warning)]" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Early Warning Advisory
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                Dispatch advisory warning when HF approaches within 0.15 of your execution trigger.
              </p>
            </div>
          </div>
          <Switch
            checked={policy.notifHfWarning}
            onCheckedChange={(checked) => onUpdatePolicy({ notifHfWarning: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

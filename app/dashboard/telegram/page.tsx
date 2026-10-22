"use client";

import React, { useState, useEffect } from "react";
import { Bot, Lock } from "lucide-react";
import { useTelegramLink } from "@/hooks/useTelegramLink";
import { useSimulation } from "@/lib/simulation-context";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { TelegramConnectionCard, type ConnectionStatus } from "@/components/dashboard/telegram/telegram-connection-card";
import { NotificationPrefsCard } from "@/components/dashboard/telegram/notification-prefs-card";
import { TELEGRAM_BOT_USERNAME } from "@/lib/telegram";

export default function TelegramPage() {
  const { state, updatePolicy, setTelegramEnabled } = useSimulation();
  const { policy, telegramEnabled, history, alerts } = state;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [statusLoading, setStatusLoading] = useState(true);

  const { linkCode, status: linkStatus, error: linkError, generateCode, reset: resetLink } =
    useTelegramLink();

  useEffect(() => {
    fetch("/api/telegram/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.linked) setStatus("connected");
      })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  const handleDisconnect = async () => {
    try {
      await fetch("/api/telegram/unlink", { method: "POST" });
    } catch {
      /* best-effort */
    }
    resetLink();
    setStatus("disconnected");
  };

  const effectiveStatus: ConnectionStatus = linkStatus === "loading" ? "pending" : status;
  const alertsSent = alerts.length;
  const executions = history.filter(
    (h) => h.action !== "NOOP" && h.status === "success"
  ).length;

  const lastAlertTime =
    alerts.length > 0
      ? (() => {
          const diff = Math.max(0, state.lastTick - alerts[0].timestamp);
          if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
          if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
          return `${Math.round(diff / 3_600_000)}h ago`;
        })()
      : "—";

  return (
    <div className="w-full p-5 md:p-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Eyebrow dot variant="brand">
            Mobile Push Bridge
          </Eyebrow>
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
            Telegram Bot API
          </span>
        </div>
        <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">
          Telegram Notifications
        </h1>
        <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
          Connect @{TELEGRAM_BOT_USERNAME} for real-time mobile push notifications on risk events
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
        {/* Main column */}
        <div className="space-y-6">
          <TelegramConnectionCard
            status={effectiveStatus}
            statusLoading={statusLoading}
            linkCode={linkCode}
            linkStatus={linkStatus}
            linkError={linkError}
            alertsSent={alertsSent}
            executions={executions}
            lastAlertTime={lastAlertTime}
            onGenerateCode={generateCode}
            onDisconnect={handleDisconnect}
            onResetLink={resetLink}
          />

          <NotificationPrefsCard
            policy={policy}
            telegramEnabled={telegramEnabled}
            onToggleMaster={setTelegramEnabled}
            onUpdatePolicy={updatePolicy}
          />
        </div>

        {/* Sidebar note */}
        <div className="space-y-4">
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-[var(--brand-bg)] border border-[var(--border)] flex items-center justify-center">
                <Bot className="size-4 text-[var(--brand)]" strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  @{TELEGRAM_BOT_USERNAME}
                </p>
                <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
                  Official Tahansoe Bot
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] space-y-1">
              <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">
                Relay Status
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`size-2 rounded-full ${
                    effectiveStatus === "connected"
                      ? "bg-[var(--safe)]"
                      : "bg-[var(--text-tertiary)]"
                  }`}
                />
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {effectiveStatus === "connected"
                    ? "Active & Relay Ready"
                    : "Awaiting One-Time Link"}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-[var(--text-secondary)] space-y-2.5 pt-2 border-t border-[var(--border)] leading-relaxed">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-[var(--text-tertiary)] font-semibold">
                <Lock className="size-3 text-[var(--brand)]" />
                <span>Zero-Knowledge Relay</span>
              </div>
              <p>
                Tahansoe alerts originate from decentralized keeper monitoring events and are routed directly to your unique Telegram chat ID.
              </p>
              <p>
                Your private keys, seed phrases, and wallet credentials are <strong>never</strong> transmitted or requested.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

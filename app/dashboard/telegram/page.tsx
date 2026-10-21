"use client";

import React, { useState, useEffect } from "react";
import {
  Bot, Check, CheckCheck, Copy, ExternalLink, Bell,
  AlertTriangle, ShieldCheck, Zap, CheckCircle,
  Unlink, Link2, Send, Loader2, BellOff,
} from "lucide-react";
import { useTelegramLink } from "@/hooks/useTelegramLink";
import { useSimulation } from "@/lib/simulation-context";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

type ConnectionStatus = "disconnected" | "pending" | "connected";

/* ── Step indicator ──────────────────────────────────────────────────────── */
function Step({ n, title, done, active }: {
  n: number; title: string; done: boolean; active: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 transition-colors ${
          done
            ? "bg-[var(--safe-bg)] border border-[var(--safe-border)] text-[var(--safe)]"
            : active
            ? "bg-[var(--brand-bg)] border border-[var(--brand)] text-[var(--brand)]"
            : "bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--text-tertiary)]"
        }`}
      >
        {done ? <Check className="w-3.5 h-3.5" strokeWidth={2.5} /> : n}
      </div>
      <span
        className={`text-xs font-medium ${
          done || active ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
        }`}
      >
        {title}
      </span>
    </div>
  );
}

/* ── Notification pref definitions ───────────────────────────────────────── */
type NotifDef = {
  key:   "notifHfWarning" | "notifTriggerFired" | "notifExecSuccess" | "notifExecFailed" | "notifPositionSafe";
  label: string;
  description: string;
  icon:  React.ElementType;
  colorVar: string;
};

const NOTIF_DEFS: NotifDef[] = [
  {
    key:         "notifHfWarning",
    label:       "Health Factor warning",
    description: "Notify when HF approaches trigger threshold — early warning before action fires.",
    icon:        AlertTriangle,
    colorVar:    "var(--warning)",
  },
  {
    key:         "notifTriggerFired",
    label:       "Trigger fired",
    description: "Instant alert when Tahansoe detects HF ≤ trigger and begins remediation.",
    icon:        Zap,
    colorVar:    "var(--danger)",
  },
  {
    key:         "notifExecSuccess",
    label:       "Execution successful",
    description: "Confirm repay or deleverage completed with before/after HF.",
    icon:        CheckCircle,
    colorVar:    "var(--safe)",
  },
  {
    key:         "notifExecFailed",
    label:       "Execution failed",
    description: "Alert if a transaction reverts (slippage, gas, flash loan failure).",
    icon:        AlertTriangle,
    colorVar:    "var(--danger)",
  },
  {
    key:         "notifPositionSafe",
    label:       "Position restored",
    description: "Notify when HF returns above target after Tahansoe intervention.",
    icon:        ShieldCheck,
    colorVar:    "var(--safe)",
  },
];

function NotifRow({ def, enabled, onChange }: {
  def: NotifDef; enabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 border-b border-[var(--border)] last:border-0">
      <div className="flex items-start gap-3">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
        >
          <def.icon style={{ width: 14, height: 14, color: def.colorVar }} strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--text-primary)]">{def.label}</p>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 max-w-[420px]">{def.description}</p>
        </div>
      </div>
      <Switch checked={enabled} onCheckedChange={onChange} size="sm" />
    </div>
  );
}

export default function TelegramPage() {
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "cuustos_bot";
  const { state, updatePolicy, setTelegramEnabled } = useSimulation();
  const { policy, telegramEnabled, history, alerts } = state;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [copied, setCopied] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  const { linkCode, status: linkStatus, error: linkError, generateCode, reset: resetLink } = useTelegramLink();

  useEffect(() => {
    fetch("/api/telegram/status")
      .then((r) => r.json())
      .then((d) => { if (d.linked) setStatus("connected"); })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  const handleDisconnect = async () => {
    try {
      await fetch("/api/telegram/unlink", { method: "POST" });
    } catch { /* best-effort */ }
    resetLink();
    setStatus("disconnected");
  };

  const deepLink = linkCode ? `https://t.me/${botUsername}?start=${linkCode}` : "";

  const handleCopyLink = () => {
    if (!deepLink) return;
    navigator.clipboard.writeText(deepLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const effectiveStatus: ConnectionStatus = linkStatus === "loading" ? "pending" : status;
  const isConnected = effectiveStatus === "connected";
  const alertsSent = alerts.length;
  const executions = history.filter((h) => h.action !== "NOOP" && h.status === "success").length;

  const lastAlertTime = alerts.length > 0
    ? (() => {
        const diff = Math.max(0, state.lastTick - alerts[0].timestamp);
        if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1_000))}s ago`;
        if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
        return `${Math.round(diff / 3_600_000)}h ago`;
      })()
    : "—";

  return (
    <div className="w-full p-5 md:p-7 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">
          Telegram Notifications
        </h1>
        <p className="text-xs text-[var(--text-tertiary)] mt-1 font-mono">
          Connect @{botUsername} for real-time mobile push notifications on risk events
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Connection Card */}
          <Card>
            <CardHeader className="border-b border-[var(--border)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isConnected
                        ? "bg-[var(--safe-bg)] border border-[var(--safe-border)] text-[var(--safe)]"
                        : "bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--text-tertiary)]"
                    }`}
                  >
                    <Bot className="w-4 h-4" strokeWidth={1.8} />
                  </div>
                  <div>
                    <CardTitle className="text-sm">@{botUsername}</CardTitle>
                    <CardDescription className="text-xs">
                      {statusLoading ? "Checking status…" : isConnected ? "Connected · Alerts Active" : "Not connected"}
                    </CardDescription>
                  </div>
                </div>

                {isConnected && (
                  <Button variant="outline" size="sm" onClick={handleDisconnect} className="gap-1.5 text-xs">
                    <Unlink className="w-3.5 h-3.5" /> Disconnect
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-5">
              {statusLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-[var(--text-tertiary)] animate-spin" strokeWidth={1.5} />
                </div>
              ) : isConnected ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2.5 p-3 rounded-lg bg-[var(--safe-bg)] border border-[var(--safe-border)]">
                    <CheckCircle className="w-4 h-4 text-[var(--safe)] shrink-0" strokeWidth={1.8} />
                    <p className="text-xs text-[var(--safe)]">
                      Telegram bot connected. Alerts will be pushed directly to your chat.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Alerts Fired", value: String(alertsSent) },
                      { label: "Executions", value: String(executions) },
                      { label: "Last Alert", value: lastAlertTime },
                    ].map((s) => (
                      <div key={s.label} className="rounded-lg p-3 bg-[var(--bg-subtle)] border border-[var(--border)]">
                        <p className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider mb-1">{s.label}</p>
                        <p className="text-lg font-mono font-medium text-[var(--text-primary)]">{s.value}</p>
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`https://t.me/${botUsername}`, "_blank")}
                    className="w-fit gap-1.5 text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open in Telegram
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-3">
                    <Step n={1} title="Generate a one-time link code" done={false} active={!linkCode} />
                    <Step n={2} title={`Send /start ${linkCode || "______"} to @${botUsername}`} done={false} active={!!linkCode} />
                    <Step n={3} title="Bot confirms and activates notifications" done={false} active={false} />
                  </div>

                  {!linkCode ? (
                    <div className="flex flex-col gap-3">
                      <Button
                        variant="primary"
                        onClick={generateCode}
                        disabled={linkStatus === "loading"}
                        className="gap-2 w-fit text-xs"
                      >
                        {linkStatus === "loading" ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…
                          </>
                        ) : (
                          <>
                            <Link2 className="w-3.5 h-3.5" /> Generate link code
                          </>
                        )}
                      </Button>
                      <p className="text-[11px] text-[var(--text-tertiary)] font-mono">
                        Code expires in 10 minutes. Send it to @{botUsername} on Telegram.
                      </p>
                      {linkError && (
                        <div className="flex items-start gap-2 p-2.5 rounded-md bg-[var(--danger-bg)] border border-[var(--danger-border)] text-xs text-[var(--danger)]">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{linkError}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 flex items-center h-10 px-3.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] font-mono text-sm tracking-widest text-[var(--text-primary)] select-all">
                          {linkCode}
                        </div>
                        <Button variant="secondary" size="md" onClick={handleCopyLink} className="gap-1.5 text-xs">
                          {copied ? (
                            <>
                              <CheckCheck className="w-3.5 h-3.5 text-[var(--safe)]" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" /> Copy code
                            </>
                          )}
                        </Button>
                      </div>

                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--brand-bg)] border border-[var(--border-strong)]">
                        <Send className="w-4 h-4 text-[var(--brand)] shrink-0 mt-0.5" strokeWidth={1.8} />
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                          Send this code to @{botUsername} to complete setup.{" "}
                          <a
                            href={deepLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[var(--brand)] hover:underline ml-1 font-medium"
                          >
                            Open in Telegram <ExternalLink className="w-3 h-3 ml-0.5" />
                          </a>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={resetLink}
                        className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors w-fit"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notification preferences */}
          <Card>
            <CardHeader className="border-b border-[var(--border)] flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Notification Preferences</CardTitle>
                <CardDescription className="text-xs">Select which events dispatch Telegram messages.</CardDescription>
              </div>
              <Button
                variant={telegramEnabled ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTelegramEnabled(!telegramEnabled)}
                className="gap-1.5 text-xs font-mono"
              >
                {telegramEnabled ? (
                  <>
                    <Bell className="w-3 h-3 text-[var(--safe)]" /> Alerts On
                  </>
                ) : (
                  <>
                    <BellOff className="w-3 h-3 text-[var(--text-tertiary)]" /> Alerts Off
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent className="px-5 py-2">
              {NOTIF_DEFS.map((def) => (
                <NotifRow
                  key={def.key}
                  def={def}
                  enabled={policy[def.key]}
                  onChange={(v) => updatePolicy({ [def.key]: v })}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Status info */}
        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-[var(--brand-bg)] border border-[var(--border)] flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-[var(--brand)]" strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">@{botUsername}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] font-mono">Telegram Push Bridge</p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] space-y-1">
              <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">Connection Status</span>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-[var(--safe)]" : "bg-[var(--text-tertiary)]"}`} />
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {isConnected ? "Active & Linked" : "Awaiting Link"}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-[var(--text-secondary)] space-y-2 pt-2 border-t border-[var(--border)]">
              <p className="font-mono text-[10px] uppercase text-[var(--text-tertiary)]">Architecture Note</p>
              <p className="leading-relaxed">
                Tahansoe alerts originate from keeper monitoring events and are routed directly to your linked chat ID without exposing your wallet private keys.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

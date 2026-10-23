"use client";

import React, { useState } from "react";
import {
  Bot,
  Check,
  CheckCheck,
  Copy,
  ExternalLink,
  Unlink,
  Link2,
  Send,
  Loader2,
  AlertTriangle,
  CheckCircle,
  BellRing,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TELEGRAM_BOT_USERNAME, getTelegramBotUrl } from "@/lib/telegram";

export type ConnectionStatus = "disconnected" | "pending" | "connected" | "paused";

interface TelegramConnectionCardProps {
  status: ConnectionStatus;
  statusLoading: boolean;
  linkCode: string | null;
  linkStatus: "idle" | "loading" | "ready" | "error";
  linkError: string | null;
  alertsSent: number;
  executions: number;
  lastAlertTime: string;
  onGenerateCode: () => void;
  onDisconnect: () => void;
  onResetLink: () => void;
}

function StepItem({
  n,
  title,
  done,
  active,
}: {
  n: number;
  title: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`size-7 rounded-full flex items-center justify-center text-[11px] font-mono font-medium shrink-0 transition-colors ${
          done
            ? "bg-[var(--safe-bg)] border border-[var(--safe-border)] text-[var(--safe)]"
            : active
            ? "bg-[var(--brand-bg)] border border-[var(--brand)] text-[var(--brand)]"
            : "bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-tertiary)]"
        }`}
      >
        {done ? <Check className="size-3.5" strokeWidth={2.5} /> : n}
      </div>
      <span
        className={`text-xs ${
          done || active
            ? "text-[var(--text-primary)] font-medium"
            : "text-[var(--text-tertiary)]"
        }`}
      >
        {title}
      </span>
    </div>
  );
}

export function TelegramConnectionCard({
  status,
  statusLoading,
  linkCode,
  linkStatus,
  linkError,
  alertsSent,
  executions,
  lastAlertTime,
  onGenerateCode,
  onDisconnect,
  onResetLink,
}: TelegramConnectionCardProps) {
  const [copied, setCopied] = useState(false);
  const isConnected = status === "connected";
  const isPaused = status === "paused";
  const deepLink = linkCode ? getTelegramBotUrl(linkCode) : getTelegramBotUrl();

  const handleCopyLink = () => {
    if (!deepLink) return;
    navigator.clipboard.writeText(deepLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`size-9 rounded-lg flex items-center justify-center border ${
                isConnected
                  ? "bg-[var(--safe-bg)] border-[var(--safe-border)] text-[var(--safe)]"
                  : isPaused
                  ? "bg-[var(--warning-bg)] border-[var(--warning-border)] text-[var(--warning)]"
                  : "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-tertiary)]"
              }`}
            >
              <Bot className="size-4" strokeWidth={1.8} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">@{TELEGRAM_BOT_USERNAME}</CardTitle>
                <Badge
                  variant={isConnected ? "safe" : isPaused ? "warning" : "outline"}
                  size="sm"
                  dot={isConnected || isPaused}
                >
                  {statusLoading
                    ? "Checking…"
                    : isConnected
                    ? "Connected"
                    : isPaused
                    ? "Paused"
                    : "Not connected"}
                </Badge>
              </div>
              <CardDescription>
                Scheduled risk research digests (2x daily) & real-time risk alerts
              </CardDescription>
            </div>
          </div>

          {isConnected && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDisconnect}
              className="gap-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)]"
            >
              <Unlink className="size-3.5" /> Disconnect
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-5">
        {statusLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 text-[var(--text-tertiary)] animate-spin" />
          </div>
        ) : isConnected ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--safe-bg)] border border-[var(--safe-border)]">
              <CheckCircle className="size-4 text-[var(--safe)] shrink-0 mt-0.5" strokeWidth={1.8} />
              <div className="text-xs text-[var(--safe)] space-y-0.5">
                <p className="font-medium">Telegram relay is linked and active.</p>
                <p className="text-[11px] opacity-90 leading-relaxed">
                  You are receiving scheduled risk research digests (2x daily) and real-time risk alerts. Send /stop in Telegram or click Disconnect to pause notifications at any time.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Alerts Dispatched", value: String(alertsSent) },
                { label: "Automated Executions", value: String(executions) },
                { label: "Last Heartbeat", value: lastAlertTime },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg p-3 bg-[var(--bg-subtle)] border border-[var(--border)]"
                >
                  <p className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider mb-1">
                    {s.label}
                  </p>
                  <p className="text-lg font-mono font-medium text-[var(--text-primary)]">
                    {s.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(getTelegramBotUrl(), "_blank")}
                className="gap-1.5 text-xs font-mono"
              >
                <ExternalLink className="size-3.5" /> Open in Telegram
              </Button>
              <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                Informational telemetry · Not investment advice
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {isPaused && !linkCode && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--warning-bg)] border border-[var(--warning-border)]">
                <AlertTriangle className="size-4 text-[var(--warning)] shrink-0 mt-0.5" strokeWidth={1.8} />
                <div className="text-xs text-[var(--warning)] space-y-0.5">
                  <p className="font-medium">Notifications are currently paused.</p>
                  <p className="text-[11px] opacity-90 leading-relaxed">
                    Alerts were paused via /stop or disconnected. Re-linking will reactivate scheduled risk digests and real-time alerts.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <StepItem
                n={1}
                title="Generate a secure one-time link code"
                done={!!linkCode}
                active={!linkCode}
              />
              <StepItem
                n={2}
                title={`Send /start ${linkCode || "______"} to @${TELEGRAM_BOT_USERNAME}`}
                done={false}
                active={!!linkCode}
              />
              <StepItem
                n={3}
                title="Bot verifies code & activates scheduled digests (2x/day) + immediate alerts"
                done={false}
                active={false}
              />
            </div>

            {!linkCode ? (
              <div className="space-y-3">
                <Button
                  variant="primary"
                  onClick={onGenerateCode}
                  disabled={linkStatus === "loading"}
                  className="gap-2 text-xs font-mono"
                >
                  {linkStatus === "loading" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Generating Nonce…
                    </>
                  ) : (
                    <>
                      <Link2 className="size-3.5" />
                      {isPaused ? "Re-link Telegram Account" : "Generate Link Code"}
                    </>
                  )}
                </Button>
                <p className="text-[11px] text-[var(--text-tertiary)] font-mono">
                  Link codes expire after 10 minutes. Re-linking reactivates paused notifications.
                </p>

                {linkError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[var(--danger-bg)] border border-[var(--danger-border)] text-xs text-[var(--danger)]">
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                    <span>{linkError}</span>
                  </div>
                )}

                <div className="p-3.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] text-xs text-[var(--text-secondary)] space-y-2">
                  <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                    <BellRing className="size-3.5 text-[var(--brand)]" />
                    <span>What you receive once connected:</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] text-[var(--text-secondary)]">
                    <li>Scheduled risk research digests (delivered twice daily: morning & evening)</li>
                    <li>Immediate push alerts on critical health factor warnings and regime shifts</li>
                  </ul>
                  <p className="text-[10px] text-[var(--text-tertiary)] pt-1 border-t border-[var(--border)] leading-normal">
                    Tahansoe provides defensive risk automation to reduce liquidation risk. It does not provide trading advice or guaranteed anti-liquidation.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center h-10 px-3.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] font-mono text-sm tracking-widest text-[var(--text-primary)] select-all">
                    {linkCode}
                  </div>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={handleCopyLink}
                    className="gap-1.5 text-xs font-mono"
                  >
                    {copied ? (
                      <>
                        <CheckCheck className="size-3.5 text-[var(--safe)]" /> Copied Link
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" /> Copy Link
                      </>
                    )}
                  </Button>
                </div>

                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[var(--brand-bg)] border border-[var(--border-strong)]">
                  <Send className="size-4 text-[var(--brand)] shrink-0 mt-0.5" strokeWidth={1.8} />
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Click to launch Telegram and submit your verification nonce to @{TELEGRAM_BOT_USERNAME}:{" "}
                    <a
                      href={deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline ml-1 font-medium"
                    >
                      Open @{TELEGRAM_BOT_USERNAME} <ExternalLink className="size-3" />
                    </a>
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onResetLink}
                  className="text-xs text-[var(--text-tertiary)]"
                >
                  Cancel and generate new code
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

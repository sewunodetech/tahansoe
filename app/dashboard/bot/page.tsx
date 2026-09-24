"use client";

import { useState, useEffect } from "react";
import {
  Bot, Check, CheckCheck, Copy, ExternalLink, Bell,
  AlertTriangle, ShieldCheck, Zap, CheckCircle,
  ToggleLeft, ToggleRight, Unlink, Link2, Send,
  Loader2, BellOff,
} from "lucide-react";
import { useTelegramLink } from "@/hooks/useTelegramLink";
import { useSimulation } from "@/lib/simulation-context";

type ConnectionStatus = "disconnected" | "pending" | "connected";

/* ── Step indicator ──────────────────────────────────────────────────────── */
function Step({ n, title, done, active }: {
  n: number; title: string; done: boolean; active: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 transition-colors"
        style={{
          background: done ? "rgba(52,211,153,0.15)" : active ? "rgba(45,212,191,0.1)" : "rgba(255,255,255,0.04)",
          border:     done ? "1px solid rgba(52,211,153,0.3)" : active ? "1px solid rgba(45,212,191,0.35)" : "1px solid rgba(255,255,255,0.08)",
          color:      done ? "#34d399" : active ? "#2dd4bf" : "rgba(255,255,255,0.2)",
        }}
      >
        {done ? <Check style={{ width: 13, height: 13 }} strokeWidth={2.5} /> : n}
      </div>
      <span className="text-[13px] font-medium"
        style={{ color: done || active ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.25)" }}>
        {title}
      </span>
    </div>
  );
}

/* ── Notification pref row ───────────────────────────────────────────────── */
type NotifDef = {
  key:   "notifHfWarning" | "notifTriggerFired" | "notifExecSuccess" | "notifExecFailed" | "notifPositionSafe";
  label: string;
  description: string;
  icon:  React.ElementType;
  color: string;
};

const NOTIF_DEFS: NotifDef[] = [
  {
    key:         "notifHfWarning",
    label:       "Health Factor warning",
    description: `Notify when HF approaches trigger threshold — early warning before action fires.`,
    icon:        AlertTriangle,
    color:       "#facc15",
  },
  {
    key:         "notifTriggerFired",
    label:       "Trigger fired",
    description: "Instant alert when Tahansoe detects HF ≤ trigger and begins remediation.",
    icon:        Zap,
    color:       "#f87171",
  },
  {
    key:         "notifExecSuccess",
    label:       "Execution successful",
    description: "Confirm repay or deleverage completed with before/after HF.",
    icon:        CheckCircle,
    color:       "#34d399",
  },
  {
    key:         "notifExecFailed",
    label:       "Execution failed",
    description: "Alert if a transaction reverts (slippage, gas, flash loan failure). Manual review required.",
    icon:        AlertTriangle,
    color:       "#f87171",
  },
  {
    key:         "notifPositionSafe",
    label:       "Position restored",
    description: "Notify when HF returns above target after Tahansoe intervention.",
    icon:        ShieldCheck,
    color:       "#34d399",
  },
];

function NotifRow({ def, enabled, onChange }: {
  def: NotifDef; enabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b last:border-0"
      style={{ borderColor: "rgba(255,255,255,0.05)" }}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: `${def.color}14`, border: `1px solid ${def.color}30` }}>
          <def.icon style={{ width: 15, height: 15, color: def.color }} strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-[13px] font-medium text-white/80">{def.label}</p>
          <p className="text-[11.5px] text-white/30 mt-0.5 max-w-[420px]">{def.description}</p>
        </div>
      </div>
      <button onClick={() => onChange(!enabled)} className="shrink-0 mt-0.5 transition-colors"
        aria-label={enabled ? "Disable" : "Enable"} aria-pressed={enabled}>
        {enabled
          ? <ToggleRight style={{ width: 32, height: 32, color: "#2dd4bf" }} strokeWidth={1.5} />
          : <ToggleLeft  style={{ width: 32, height: 32 }} className="text-white/20" strokeWidth={1.5} />
        }
      </button>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function BotPage() {
  const { state, updatePolicy, setTelegramEnabled } = useSimulation();
  const { policy, telegramEnabled, history, alerts } = state;

  const [status,       setStatus]       = useState<ConnectionStatus>("disconnected");
  const [copied,       setCopied]       = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);

  const { linkCode, status: linkStatus, error: linkError, generateCode, reset: resetLink } = useTelegramLink();

  /* Check real Telegram link status on mount */
  useEffect(() => {
    fetch("/api/telegram/status")
      .then((r) => r.json())
      .then((d) => { if (d.linked) setStatus("connected"); })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  useEffect(() => {
    if (linkStatus === "loading") setStatus("pending");
  }, [linkStatus]);

  /* Real unlink: DELETE /api/telegram/status (or POST /api/telegram/unlink) */
  const handleDisconnect = async () => {
    try {
      await fetch("/api/telegram/unlink", { method: "POST" });
    } catch { /* best-effort */ }
    resetLink();
    setStatus("disconnected");
  };

  const deepLink = linkCode ? `https://t.me/cuustos_bot?start=${linkCode}` : "";

  const handleCopyLink = () => {
    if (!deepLink) return;
    navigator.clipboard.writeText(deepLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const isConnected   = status === "connected";
  const enabledCount  = NOTIF_DEFS.filter((d) => policy[d.key]).length;

  /* Stats derived from simulation state */
  const alertsSent    = alerts.length;
  const executions    = history.filter((h) => h.action !== "NOOP" && h.status === "success").length;
  const lastAlertTime = alerts.length > 0
    ? (() => {
        const diff = Date.now() - alerts[0].timestamp;
        if (diff < 60_000)   return `${Math.round(diff / 1_000)}s ago`;
        if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
        return `${Math.round(diff / 3_600_000)}h ago`;
      })()
    : "—";

  return (
    <div className="w-full p-5 md:p-7 space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-[18px] font-semibold text-white tracking-[-0.02em]">Telegram Bot</h1>
        <p className="text-[12px] text-white/30 mt-0.5">
          Connect @cuustos_bot for real-time alerts on every position event.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">

        {/* ── Left column ───────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Connection card */}
          <div className="rounded-[10px] overflow-hidden"
            style={{ background: "rgba(255,255,255,0.015)", border: isConnected ? "1px solid rgba(52,211,153,0.2)" : "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-[8px] flex items-center justify-center"
                  style={{ background: isConnected ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.05)", border: isConnected ? "1px solid rgba(52,211,153,0.25)" : "1px solid rgba(255,255,255,0.08)" }}>
                  <Bot style={{ width: 16, height: 16, color: isConnected ? "#34d399" : "rgba(255,255,255,0.3)" }} strokeWidth={1.5} />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-white/80">@cuustos_bot</p>
                  <p className="text-[11px] text-white/30">
                    {statusLoading ? "Checking status…" : isConnected ? "Connected · alerts active" : "Not connected"}
                  </p>
                </div>
              </div>
              {isConnected && (
                <button onClick={handleDisconnect}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-[6px] text-[11.5px] transition-colors"
                  style={{ border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(248,113,113,0.3)"; e.currentTarget.style.color = "#f87171"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}>
                  <Unlink style={{ width: 12, height: 12 }} strokeWidth={1.5} /> Disconnect
                </button>
              )}
            </div>

            <div className="p-5">
              {statusLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-white/20 animate-spin" strokeWidth={1.5} />
                </div>
              ) : isConnected ? (
                /* ── Connected state ── */
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2.5 p-3 rounded-[8px]"
                    style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)" }}>
                    <CheckCircle style={{ width: 15, height: 15, color: "#34d399" }} className="shrink-0" strokeWidth={1.5} />
                    <p className="text-[12.5px]" style={{ color: "rgba(52,211,153,0.8)" }}>
                      Telegram connected. Notifications will be sent to your chat.
                    </p>
                  </div>

                  {/* Live stats from simulation */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Alerts fired",  value: String(alertsSent) },
                      { label: "Executions",    value: String(executions) },
                      { label: "Last alert",    value: lastAlertTime },
                    ].map((s) => (
                      <div key={s.label} className="rounded-[8px] px-3 py-2.5"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <p className="text-[10px] font-mono text-white/25 uppercase tracking-[0.1em] mb-1">{s.label}</p>
                        <p className="text-[18px] font-semibold text-white tracking-[-0.02em]">{s.value}</p>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => window.open("https://t.me/cuustos_bot", "_blank")}
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-[7px] text-[12.5px] transition-colors w-fit"
                    style={{ border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.8)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.background = ""; }}>
                    <ExternalLink style={{ width: 13, height: 13 }} strokeWidth={1.5} /> Open in Telegram
                  </button>
                </div>
              ) : (
                /* ── Not connected state ── */
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-3">
                    <Step n={1} title="Generate a one-time link code" done={false} active={!linkCode} />
                    <Step n={2} title={`Send /start ${linkCode || "______"} to @cuustos_bot`} done={false} active={!!linkCode} />
                    <Step n={3} title="Bot confirms and links your account" done={false} active={false} />
                  </div>

                  {!linkCode ? (
                    <div className="flex flex-col gap-3">
                      <button onClick={generateCode} disabled={linkStatus === "loading"}
                        className="inline-flex items-center gap-2 h-9 px-5 rounded-[8px] text-[13px] font-semibold transition-opacity disabled:opacity-40 w-fit"
                        style={{ background: "linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)", color: "#042f2e" }}>
                        {linkStatus === "loading"
                          ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" strokeWidth={2} />Generating…</>
                          : <><Link2  style={{ width: 13, height: 13 }} strokeWidth={2} />Generate link code</>
                        }
                      </button>
                      <p className="text-[11px] text-white/20">
                        Code expires in 10 minutes. Send it to @cuustos_bot on Telegram to complete linking.
                      </p>
                      {linkError && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-[6px]"
                          style={{ background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.15)" }}>
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "rgba(248,113,113,0.7)" }} strokeWidth={1.5} />
                          <p className="text-[11px]" style={{ color: "rgba(248,113,113,0.7)" }}>{linkError}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 flex items-center gap-2 h-10 px-3.5 rounded-[7px]"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <span className="font-mono text-[14px] text-white/70 tracking-[0.2em] select-all">{linkCode}</span>
                        </div>
                        <button onClick={handleCopyLink}
                          className="flex items-center gap-1.5 h-10 px-3.5 rounded-[7px] text-[12px] transition-colors shrink-0"
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)";  e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}>
                          {copied
                            ? <><CheckCheck className="w-3.5 h-3.5" style={{ color: "#34d399" }} strokeWidth={2} />Copied</>
                            : <><Copy       className="w-3.5 h-3.5" strokeWidth={1.5} />Copy code</>
                          }
                        </button>
                      </div>

                      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-[7px]"
                        style={{ background: "rgba(45,212,191,0.06)", border: "1px solid rgba(45,212,191,0.15)" }}>
                        <Send className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "rgba(45,212,191,0.6)" }} strokeWidth={1.5} />
                        <p className="text-[11px] leading-relaxed" style={{ color: "rgba(45,212,191,0.7)" }}>
                          Send this code to @cuustos_bot to complete linking.{" "}
                          <a href={deepLink} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:no-underline"
                            style={{ color: "rgba(45,212,191,0.9)" }}>
                            Open in Telegram <ExternalLink className="w-2.5 h-2.5" strokeWidth={1.5} />
                          </a>
                        </p>
                      </div>

                      <button onClick={resetLink} className="text-[11px] w-fit transition-colors"
                        style={{ color: "rgba(255,255,255,0.2)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.2)"; }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Notification preferences — wired to simulation context */}
          <div className="rounded-[10px] overflow-hidden"
            style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between px-5 py-3.5"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div>
                <h2 className="text-[12.5px] font-semibold text-white/80">Notification preferences</h2>
                <p className="text-[11px] text-white/25 mt-0.5">
                  Choose which events trigger a Telegram message. Changes apply immediately.
                </p>
              </div>
              {/* Master telegram toggle — synced with Settings */}
              <button
                onClick={() => setTelegramEnabled(!telegramEnabled)}
                title={telegramEnabled ? "Telegram alerts on" : "Telegram alerts off"}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[11px] font-mono transition-all shrink-0"
                style={
                  telegramEnabled
                    ? { background: "rgba(45,212,191,0.1)",   border: "1px solid rgba(45,212,191,0.25)",  color: "#2dd4bf" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }
                }>
                {telegramEnabled
                  ? <><Bell    style={{ width: 11, height: 11 }} strokeWidth={1.5} /> Alerts on</>
                  : <><BellOff style={{ width: 11, height: 11 }} strokeWidth={1.5} /> Alerts off</>
                }
              </button>
            </div>
            <div className="px-5">
              {NOTIF_DEFS.map((def) => (
                <NotifRow
                  key={def.key}
                  def={def}
                  enabled={policy[def.key]}
                  onChange={(v) => updatePolicy({ [def.key]: v })}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Right column ──────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Bot summary */}
          <div className="rounded-[10px] p-5"
            style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(45,212,191,0.12)" }}>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-[8px] flex items-center justify-center"
                style={{ background: "rgba(45,212,191,0.1)", border: "1px solid rgba(45,212,191,0.2)" }}>
                <Bot style={{ width: 14, height: 14, color: "#2dd4bf" }} strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-[12px] font-semibold text-white/70">@cuustos_bot</p>
                <p className="text-[10px] text-white/25 font-mono">t.me/cuustos_bot</p>
              </div>
            </div>

            <div className="space-y-2 p-3 rounded-[8px] mb-4"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <p className="text-[10px] font-mono text-white/25 uppercase tracking-[0.1em]">Connection</p>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: isConnected ? "#34d399" : "rgba(255,255,255,0.15)" }} />
                <span className="text-[12px] font-medium"
                  style={{ color: isConnected ? "#34d399" : "rgba(255,255,255,0.25)" }}>
                  {isConnected ? "Connected" : "Not connected"}
                </span>
              </div>
            </div>

            {/* Active alert types */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono text-white/25 uppercase tracking-[0.1em] mb-2">
                Active alerts ({enabledCount}/{NOTIF_DEFS.length})
              </p>
              {NOTIF_DEFS.map((d) => (
                <div key={d.key} className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full shrink-0"
                    style={{ backgroundColor: policy[d.key] ? d.color : "rgba(255,255,255,0.1)" }} />
                  <span className="text-[11px] truncate"
                    style={{ color: policy[d.key] ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.15)" }}>
                    {d.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Bot commands — not available yet, monitoring only */}
          <div className="rounded-[10px] p-4"
            style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-flex items-center gap-1.5 h-5 px-2 rounded-full text-[9px] font-bold font-mono tracking-wider uppercase"
                style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}
              >
                Monitoring only
              </span>
            </div>
            <p className="text-[11px] text-white/25 leading-relaxed">
              The bot currently sends one-way push notifications only.
              Interactive commands (/status, /pause, etc.) are planned for a future release.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

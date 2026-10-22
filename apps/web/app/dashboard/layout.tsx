"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDisconnect } from "wagmi";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { SidebarNav, SearchModal } from "@/components/ui/dashboard-sidebar";
import { DashboardTopbar } from "@/components/ui/dashboard-topbar";
import { SimulationProvider, useSimulation, type AlertEvent } from "@/lib/simulation-context";
import { SimulationEngine } from "@/lib/simulation-engine";
import { OnboardingTourProvider } from "@/components/ui/onboarding-tour";
import { DashboardModeProvider, useDashboardMode } from "@/lib/dashboard-mode";
import { Loader2, X, AlertTriangle, CheckCircle, Zap, Bell } from "lucide-react";

/* ── Alert toast ─────────────────────────────────────────────────────────── */
function AlertToast({
  alert,
  onDismiss,
}: {
  alert: AlertEvent;
  onDismiss: (id: string) => void;
}) {
  /* auto-dismiss after 7 s */
  useEffect(() => {
    const t = setTimeout(() => onDismiss(alert.id), 7_000);
    return () => clearTimeout(t);
  }, [alert.id, onDismiss]);

  const cfg = {
    critical: {
      icon:   AlertTriangle,
      color:  "var(--danger)",
      border: "var(--danger-border)",
      bg:     "var(--danger-bg)",
    },
    warning: {
      icon:   Bell,
      color:  "var(--warning)",
      border: "var(--warning-border)",
      bg:     "var(--warning-bg)",
    },
    executed: {
      icon:   CheckCircle,
      color:  "var(--safe)",
      border: "var(--safe-border)",
      bg:     "var(--safe-bg)",
    },
    recovered: {
      icon:   CheckCircle,
      color:  "var(--safe)",
      border: "var(--safe-border)",
      bg:     "var(--safe-bg)",
    },
  }[alert.type] ?? {
    icon: Zap,
    color: "var(--text-tertiary)",
    border: "var(--border)",
    bg: "var(--bg-subtle)",
  };

  const Icon = cfg.icon;

  return (
    <div
      className="flex items-start gap-3 w-[320px] rounded-xl px-4 py-3 shadow-2xl pointer-events-auto bg-[var(--bg-elevated)] border border-[var(--border-strong)] backdrop-blur-md"
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
      >
        <Icon style={{ width: 14, height: 14, color: cfg.color }} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-[var(--text-primary)] leading-snug">
          {alert.message.split("\n")[0].replace(/^[^\w]+/, "")}
        </p>
        <p className="text-[10.5px] text-[var(--text-tertiary)] mt-0.5 font-mono">
          {alert.protocol} · {alert.chain} · HF {alert.hf.toFixed(2)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(alert.id)}
        className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors mt-0.5 cursor-pointer"
        aria-label="Dismiss alert"
      >
        <X style={{ width: 12, height: 12 }} strokeWidth={2} />
      </button>
    </div>
  );
}

/* ── Toast container (reads from SimulationContext) ──────────────────────── */
function AlertToastContainer() {
  const { activeAlerts, dismissAlert, state } = useSimulation();
  const { isLive } = useDashboardMode();
  if (isLive || !state.policy.alertsEnabled) return null;
  const visible = activeAlerts.slice(0, 4);

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9800] flex flex-col gap-2.5 pointer-events-none">
      {visible.map((a) => (
        <AlertToast key={a.id} alert={a} onDismiss={dismissAlert} />
      ))}
    </div>
  );
}

/* ── Inner layout ────────────────────────────────────────────────────────── */
function DashboardInner({ children }: { children: React.ReactNode }) {
  const { isConnected, address } = useAuthGuard();
  const { disconnect } = useDisconnect();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  /* ⌘K shortcut */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const handleDisconnect = () => {
    disconnect();
    router.replace("/connect");
  };

  const handleTourNavigate = (path: string) => {
    router.push(path);
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <OnboardingTourProvider onNavigate={handleTourNavigate}>
      <div className="flex h-screen overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]">
        {/* Sidebar */}
        <div
          className="h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
          style={{ width: collapsed ? 64 : 264 }}
        >
          <SidebarNav
            address={address}
            onDisconnect={handleDisconnect}
            collapsed={collapsed}
          />
        </div>

        {/* Main viewport */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Topbar */}
          <DashboardTopbar
            collapsed={collapsed}
            onToggleSidebar={() => setCollapsed((v) => !v)}
            onOpenSearch={() => setSearchOpen(true)}
            address={address}
            onDisconnect={handleDisconnect}
          />

          {/* Children from Next.js routing */}
          <main className="flex-1 overflow-y-auto scrollbar-hide bg-[var(--bg)]">
            {children}
          </main>
        </div>

        {/* Alert toasts */}
        <AlertToastContainer />

        {/* Search modal */}
        {searchOpen && (
          <SearchModal
            onClose={() => setSearchOpen(false)}
            onSelect={(href) => {
              router.push(href);
              setSearchOpen(false);
            }}
          />
        )}
      </div>
    </OnboardingTourProvider>
  );
}

/* ── Simulation ticker: demo mode only ───────────────────────────────────
   The simulator also posts alerts to Telegram (/api/alerts/notify), so it
   must not run while the dashboard shows the wallet's real position. */
function DemoSimulationEngine() {
  const { isLive } = useDashboardMode();
  return isLive ? null : <SimulationEngine />;
}

/* ── Root layout export ──────────────────────────────────────────────────── */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardModeProvider>
      <SimulationProvider>
        <DemoSimulationEngine />
        <DashboardInner>{children}</DashboardInner>
      </SimulationProvider>
    </DashboardModeProvider>
  );
}

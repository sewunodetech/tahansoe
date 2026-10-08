"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDisconnect, useAccount } from "wagmi";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { SidebarNav, SearchModal } from "@/components/ui/dashboard-sidebar";
import { SimulationProvider, useSimulation } from "@/lib/simulation-context";
import { SimulationEngine } from "@/lib/simulation-engine";
import { OnboardingTourProvider, useTour } from "@/components/ui/onboarding-tour";
import { PanelLeft, Search, Loader2, X, AlertTriangle, CheckCircle, Zap, Bell } from "lucide-react";
import dynamic from "next/dynamic";

/* ── Page registry ────────────────────────────────────────────────────────── */
const PAGES: Record<string, React.ComponentType> = {
  home:             dynamic(() => import("./page"),              { ssr: false }),
  positions:        dynamic(() => import("./positions/page"),    { ssr: false }),
  "pos-active":     dynamic(() => import("./positions/page"),    { ssr: false }),
  "pos-monitoring": dynamic(() => import("./positions/page"),    { ssr: false }),
  history:          dynamic(() => import("./history/page"),      { ssr: false }),
  chat:             dynamic(() => import("./chat/page"),         { ssr: false }),
  bot:              dynamic(() => import("./bot/page"),          { ssr: false }),
  settings:         dynamic(() => import("./settings/page"),     { ssr: false }),
};

const PAGE_TITLE: Record<string, string> = {
  home:             "Overview",
  positions:        "Positions",
  "pos-active":     "Positions",
  "pos-monitoring": "Positions",
  history:          "History",
  chat:             "AI Assistant",
  bot:              "Telegram Bot",
  settings:         "Settings",
};

/* ── Alert toast ─────────────────────────────────────────────────────────── */
function AlertToast({
  alert,
  onDismiss,
}: {
  alert: import("@/lib/simulation-context").AlertEvent;
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
      color:  "#f87171",
      border: "rgba(248,113,113,0.25)",
      bg:     "rgba(248,113,113,0.07)",
    },
    warning: {
      icon:   Bell,
      color:  "#facc15",
      border: "rgba(250,204,21,0.25)",
      bg:     "rgba(250,204,21,0.07)",
    },
    executed: {
      icon:   CheckCircle,
      color:  "#34d399",
      border: "rgba(52,211,153,0.25)",
      bg:     "rgba(52,211,153,0.07)",
    },
    recovered: {
      icon:   CheckCircle,
      color:  "#34d399",
      border: "rgba(52,211,153,0.25)",
      bg:     "rgba(52,211,153,0.07)",
    },
  }[alert.type] ?? {
    icon: Zap, color: "#94a3b8",
    border: "rgba(148,163,184,0.2)", bg: "rgba(148,163,184,0.05)",
  };

  const Icon = cfg.icon;

  return (
    <div
      className="flex items-start gap-3 w-[320px] rounded-[10px] px-4 py-3 shadow-xl pointer-events-auto"
      style={{
        background:   "rgba(11,12,15,0.97)",
        border:       `1px solid ${cfg.border}`,
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        className="w-7 h-7 rounded-[7px] flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
      >
        <Icon style={{ width: 14, height: 14, color: cfg.color }} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-white/85 leading-snug">
          {alert.message.split("\n")[0].replace(/^[^\w]+/, "")}
        </p>
        <p className="text-[10.5px] text-white/35 mt-0.5 font-mono">
          {alert.protocol} · {alert.chain} · HF {alert.hf.toFixed(2)}
        </p>
      </div>
      <button
        onClick={() => onDismiss(alert.id)}
        className="shrink-0 text-white/20 hover:text-white/50 transition-colors mt-0.5"
      >
        <X style={{ width: 12, height: 12 }} strokeWidth={2} />
      </button>
    </div>
  );
}

/* ── Toast container (reads from SimulationContext) ──────────────────────── */
function AlertToastContainer() {
  const { activeAlerts, dismissAlert, state } = useSimulation();
  if (!state.policy.alertsEnabled) return null;
  const visible = activeAlerts.slice(0, 4); // max 4 stacked

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9800] flex flex-col gap-2.5 pointer-events-none">
      {visible.map((a) => (
        <AlertToast key={a.id} alert={a} onDismiss={dismissAlert} />
      ))}
    </div>
  );
}

/* ── ETH price ticker (topbar) ───────────────────────────────────────────── */
function EthPriceTicker() {
  const { state } = useSimulation();
  const { price, change24h } = state.ethPrice;
  const up = change24h >= 0;

  return (
    <div
      className="hidden md:flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] font-mono text-[11px]"
      style={{
        background: "var(--bg-subtle)",
        border:     "1px solid var(--border)",
      }}
    >
      <span className="text-white/30">ETH</span>
      <span className="text-white/70">${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      <span style={{ color: up ? "#34d399" : "#f87171" }}>
        {up ? "▲" : "▼"} {Math.abs(change24h).toFixed(2)}%
      </span>
    </div>
  );
}

/* ── Restart tour button (topbar) ────────────────────────────────────────── */
function TourTrigger() {
  const { restart } = useTour();
  return (
    <button
      onClick={restart}
      title="Restart app tour"
      className="hidden md:flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[10.5px] font-mono transition-colors"
      style={{
        background: "var(--bg-subtle)",
        border:     "1px solid var(--border)",
        color:      "var(--text-tertiary)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "rgba(74,181,224,0.3)";
        e.currentTarget.style.color       = "#4ab5e0";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.color       = "var(--text-tertiary)";
      }}
    >
      ? Tour
    </button>
  );
}

/* ── Simulation status pill ──────────────────────────────────────────────── */
function SimStatusPill() {
  const { state } = useSimulation();
  const label = state.isPaused ? "paused" : state.isRunning ? "simulating" : "stopped";
  const color = state.isPaused ? "#94a3b8"  : state.isRunning ? "#34d399" : "#64748b";
  return (
    <div className="hidden lg:flex items-center gap-1.5 font-mono text-[10px] text-white/25">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{
          backgroundColor: color,
          animation: state.isRunning && !state.isPaused ? "pulse 2s infinite" : "none",
        }}
      />
      {label}
    </div>
  );
}

/* ── Inner layout (needs context) ────────────────────────────────────────── */
function DashboardInner() {
  const { isConnected, address } = useAuthGuard();
  const { disconnect }            = useDisconnect();
  const router                    = useRouter();

  const [collapsed,  setCollapsed]  = useState(false);
  const [activeId,   setActiveId]   = useState("home");
  const [searchOpen, setSearchOpen] = useState(false);

  /* ⌘K shortcut */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const handleDisconnect = () => { disconnect(); router.replace("/connect"); };
  const handleSelect = useCallback((id: string) => {
    if (id === "search") { setSearchOpen(true); return; }
    setActiveId(id);
  }, []);

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <Loader2 className="animate-spin" style={{ width: 20, height: 20, color: "var(--text-tertiary)" }} strokeWidth={1.5} />
      </div>
    );
  }

  const pageTitle  = PAGE_TITLE[activeId] ?? activeId;
  const ActivePage = PAGES[activeId] ?? PAGES["home"];

  return (
    <OnboardingTourProvider onNavigate={handleSelect}>
      <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>

        {/* ── Sidebar ──────────────────────────────────────────── */}
        <div
          className="h-full shrink-0 overflow-hidden"
          style={{ width: collapsed ? 52 : 232, transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)" }}
        >
          <SidebarNav
            activeId={activeId}
            onSelect={handleSelect}
            address={address}
            onDisconnect={handleDisconnect}
            collapsed={collapsed}
          />
        </div>

        {/* ── Main ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Topbar */}
          <header
            className="shrink-0 flex items-center justify-between h-[52px] px-4"
            style={{ background: "var(--topbar-bg)", borderBottom: "1px solid var(--topbar-border)" }}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCollapsed((v) => !v)}
                className="w-8 h-8 flex items-center justify-center rounded-[6px] transition-colors"
                style={{ color: "var(--text-secondary)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--item-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-secondary)"; }}
                aria-label="Toggle sidebar"
              >
                <PanelLeft style={{ width: 15, height: 15 }} strokeWidth={1.5} />
              </button>
              <div className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>Tahansoe</span>
                <span style={{ color: "var(--border-strong)" }} className="text-[12px]">/</span>
                <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{pageTitle}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <SimStatusPill />
              <EthPriceTicker />
              <TourTrigger />
              <button
                onClick={() => setSearchOpen(true)}
                className="hidden md:flex items-center gap-2 h-8 px-3 rounded-[6px] text-[12px] transition-colors"
                style={{ color: "var(--text-tertiary)", background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)";        e.currentTarget.style.color = "var(--text-tertiary)"; }}
              >
                <Search style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                <span className="font-mono">Search</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[4px]"
                  style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-strong)", color: "var(--text-tertiary)" }}>
                  ⌘K
                </span>
              </button>
            </div>
          </header>

          {/* Page */}
          <main className="flex-1 overflow-y-auto scrollbar-hide" style={{ background: "var(--bg)" }}>
            <ActivePage />
          </main>
        </div>

        {/* Alert toasts */}
        <AlertToastContainer />

        {/* Search modal */}
        {searchOpen && (
          <SearchModal onClose={() => setSearchOpen(false)} onSelect={(id) => { setActiveId(id); setSearchOpen(false); }} />
        )}
      </div>
    </OnboardingTourProvider>
  );
}

/* ── Root layout export ──────────────────────────────────────────────────── */
export default function DashboardLayout({ children: _c }: { children: React.ReactNode }) {
  return (
    <SimulationProvider>
      <SimulationEngine />
      <DashboardInner />
    </SimulationProvider>
  );
}

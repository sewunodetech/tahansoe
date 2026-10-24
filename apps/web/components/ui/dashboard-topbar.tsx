"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, Search, Wallet, ChevronRight, Pause, Play } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useTour } from "@/components/ui/onboarding-tour";
import { useProtection } from "@/hooks/useProtection";
import { useDashboardMode } from "@/lib/dashboard-mode";

export interface DashboardTopbarProps {
  collapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenSearch?: () => void;
  address?: string;
  onDisconnect?: () => void;
}

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/protection": "Protection",
  "/dashboard/protection/setup": "Protection Setup",
  "/dashboard/activity": "Activity",
  "/dashboard/agents": "Agents",
  "/dashboard/telegram": "Telegram",
  "/dashboard/settings": "Settings",
};

export function DashboardTopbar({
  collapsed = false,
  onToggleSidebar,
  onOpenSearch,
  address,
  onDisconnect,
}: DashboardTopbarProps) {
  const pathname = usePathname();
  const { isPaused, actions, ethPrice } = useProtection();
  const { restart: restartTour } = useTour();
  const { mode, setMode, isLive, isSimulation } = useDashboardMode();

  const currentLabel = ROUTE_LABELS[pathname] ?? "Dashboard";
  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "0x1A5D…D97E";

  const isEthUp = ethPrice.change24h >= 0;

  return (
    <header
      className="shrink-0 flex items-center justify-between h-[60px] px-4 select-none"
      style={{
        background: "var(--topbar-bg)",
        borderBottom: "1px solid var(--topbar-border)",
      }}
    >
      {/* ── Left: Sidebar toggle & Breadcrumbs ── */}
      <div className="flex items-center gap-2.5">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="w-8 h-8 flex items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--item-hover)] transition-colors cursor-pointer"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeft className="w-4 h-4" strokeWidth={1.5} />
          </button>
        )}

        <div className="w-px h-4 mx-0.5 bg-[var(--border)]" />

        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-medium">
          <Link
            href="/dashboard"
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Tahansoe
          </Link>
          <ChevronRight className="w-3 h-3 text-[var(--border-strong)] shrink-0" strokeWidth={1.5} />
          <span className="text-[var(--text-primary)]">{currentLabel}</span>
        </nav>
      </div>

      {/* ── Right: Live/Demo switch, simulation controls, Theme, Tour, Wallet ── */}
      <div className="flex items-center gap-2">
        {isSimulation ? (
          <span
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[11px] font-mono text-[var(--warning)]"
            title="Fake funds on a fork of Arbitrum One"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)] animate-pulse" />
            Simulation
          </span>
        ) : (
          /* Live / Demo switch */
          <div
            role="radiogroup"
            aria-label="Data source"
            className="flex items-center h-7 p-0.5 rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] text-[11px] font-mono"
          >
            {(["live", "demo"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                title={m === "live" ? "Your real Aave position on Arbitrum Sepolia" : "Simulated position and market"}
                className={`flex items-center gap-1.5 h-6 px-2.5 rounded-full transition-colors cursor-pointer ${
                  mode === m
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    m === "live" ? "bg-[var(--safe)]" : "bg-[var(--warning)]"
                  }`}
                />
                {m === "live" ? "Live" : "Demo"}
              </button>
            ))}
          </div>
        )}

        {!isLive && (
          <>
            {/* ETH Price Ticker (simulated) */}
            <div className="hidden lg:flex items-center gap-1.5 h-7 px-2.5 rounded-md font-mono text-[11px] bg-[var(--bg-subtle)] border border-[var(--border)]">
              <span className="text-[var(--text-tertiary)]">ETH</span>
              <span className="text-[var(--text-secondary)]">
                ${ethPrice.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className={isEthUp ? "text-[var(--safe)]" : "text-[var(--danger)]"}>
                {isEthUp ? "▲" : "▼"} {Math.abs(ethPrice.change24h).toFixed(2)}%
              </span>
            </div>

            {/* Simulation ticker pause */}
            <button
              type="button"
              onClick={() => actions.setPaused(!isPaused)}
              className="flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              title={isPaused ? "Resume simulation ticker" : "Pause simulation ticker"}
              aria-label={isPaused ? "Resume simulation" : "Pause simulation"}
            >
              {isPaused ? <Play className="w-2.5 h-2.5 fill-current" /> : <Pause className="w-2.5 h-2.5 fill-current" />}
            </button>
          </>
        )}

        {/* ⌘K Search trigger */}
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="hidden md:flex items-center gap-2 h-7 px-2.5 rounded-md text-xs text-[var(--text-tertiary)] bg-[var(--bg-subtle)] border border-[var(--border)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            <Search className="w-3 h-3" strokeWidth={1.5} />
            <span className="font-mono text-[11px]">Search</span>
            <kbd className="text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border border-[var(--border)]">
              ⌘K
            </kbd>
          </button>
        )}

        {/* Tour trigger */}
        <button
          type="button"
          onClick={restartTour}
          title="Restart app walkthrough"
          className="hidden sm:inline-flex items-center h-7 px-2 rounded-md text-[11px] font-mono text-[var(--text-tertiary)] bg-[var(--bg-subtle)] border border-[var(--border)] hover:text-[var(--brand)] hover:border-[var(--brand)] transition-colors cursor-pointer"
        >
          ? Tour
        </button>

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Wallet pill */}
        <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-[var(--bg-subtle)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-primary)]">
          <Wallet className="w-3 h-3 text-[var(--brand)] shrink-0" strokeWidth={1.8} />
          <span>{shortAddress}</span>
          {onDisconnect && (
            <button
              type="button"
              onClick={onDisconnect}
              className="ml-1 text-[var(--text-tertiary)] hover:text-[var(--danger)] text-[10px] transition-colors"
              title="Disconnect wallet"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

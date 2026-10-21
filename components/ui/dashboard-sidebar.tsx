"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ShieldCheck,
  Clock,
  Settings,
  LogOut,
  Search,
  Sparkles,
  Send,
  X,
  Command,
  MoreHorizontal,
} from "lucide-react";
import { BrandMark } from "@/components/ui/brand-mark";

/* ══════════════════════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════════════════════ */
export type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: string | number;
  shortcut?: string;
  tourId?: string;
};

/* ══════════════════════════════════════════════════════════════════════════
   NAV DATA (Phase 3: Overview · Protection · Activity · Agents · Telegram · Settings)
   ══════════════════════════════════════════════════════════════════════════ */
export const MAIN_NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    tourId: "tour-nav-home",
  },
  {
    href: "/dashboard/protection",
    label: "Protection",
    icon: ShieldCheck,
    tourId: "tour-nav-protection",
    badge: "3 Layers",
  },
  {
    href: "/dashboard/activity",
    label: "Activity",
    icon: Clock,
    tourId: "tour-nav-activity",
  },
  {
    href: "/dashboard/agents",
    label: "Agents",
    icon: Sparkles,
    tourId: "tour-nav-agents",
    badge: "2 Active",
  },
  {
    href: "/dashboard/telegram",
    label: "Telegram",
    icon: Send,
    tourId: "tour-nav-telegram",
  },
];

export const BOTTOM_ITEMS: NavItem[] = [
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: Settings,
    shortcut: "⌘,",
    tourId: "tour-nav-settings",
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   NAV LINK COMPONENT
   ══════════════════════════════════════════════════════════════════════════ */
function NavLinkRow({
  item,
  collapsed,
  isActive,
}: {
  item: NavItem;
  collapsed: boolean;
  isActive: boolean;
}) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      data-tour-id={item.tourId}
      className={`relative flex items-center w-full rounded-md select-none outline-none transition-colors duration-100 ${
        collapsed ? "justify-center px-2 py-1.5" : "gap-2 px-2.5 py-1.5"
      } ${
        isActive
          ? "bg-[var(--item-active-bg)] text-[var(--item-active-text)] font-medium"
          : "text-[var(--text-secondary)] hover:bg-[var(--item-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {/* Active left indicator bar */}
      {isActive && !collapsed && (
        <span
          className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-[var(--brand)]"
        />
      )}

      <item.icon
        className={`shrink-0 transition-colors ${
          isActive ? "text-[var(--brand)]" : "text-[var(--text-tertiary)]"
        }`}
        style={{ width: 15, height: 15 }}
        strokeWidth={isActive ? 2 : 1.5}
      />

      {!collapsed && (
        <>
          <span className="flex-1 text-[12.5px] tracking-[-0.01em] truncate leading-none">
            {item.label}
          </span>

          <div className="flex items-center gap-1 ml-auto shrink-0">
            {item.badge && (
              <span className="inline-flex items-center h-4 px-1.5 rounded-[4px] text-[9px] font-bold font-mono tracking-wide bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border)]">
                {item.badge}
              </span>
            )}
            {item.shortcut && (
              <kbd className="hidden group-hover:inline-flex items-center h-4 px-1.5 text-[9px] font-mono rounded-[4px] text-[var(--text-tertiary)] bg-[var(--bg-subtle)] border border-[var(--border)]">
                {item.shortcut}
              </kbd>
            )}
          </div>
        </>
      )}
    </Link>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SIDEBAR NAV
   ══════════════════════════════════════════════════════════════════════════ */
export interface SidebarNavProps {
  activeId?: string;
  onSelect?: (id: string) => void;
  address?: string;
  onDisconnect?: () => void;
  collapsed?: boolean;
}

export function SidebarNav({
  address,
  onDisconnect,
  collapsed = false,
}: SidebarNavProps) {
  const pathname = usePathname();

  const short = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "0x1A5D…D97E";

  const isItemActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="flex flex-col h-full overflow-hidden select-none"
      style={{
        width: collapsed ? 52 : 232,
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
      }}
    >
      {/* ── Logo header ──────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center h-[52px] px-4"
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        <Link href="/dashboard" className="flex items-center">
          {collapsed ? (
            <div data-tour-id="tour-logo" className="w-7 h-7 flex items-center justify-center">
              <BrandMark size={22} />
            </div>
          ) : (
            <div data-tour-id="tour-logo" className="flex items-center gap-2.5">
              <BrandMark size={24} className="shrink-0" />
              <div className="flex flex-col">
                <span className="font-display text-[18px] font-medium leading-none text-[var(--text-primary)]">
                  Tahansoe
                </span>
                <span className="text-[10px] leading-none mt-0.5 font-mono text-[var(--brand)] opacity-80">
                  Risk Automation
                </span>
              </div>
            </div>
          )}
        </Link>
      </div>

      {/* ── Main nav items ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide px-2 py-3 flex flex-col gap-1">
        {!collapsed && (
          <div className="px-2 pb-1 pt-0.5">
            <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--text-tertiary)] font-mono">
              Dashboard
            </span>
          </div>
        )}

        {MAIN_NAV_ITEMS.map((item) => (
          <NavLinkRow
            key={item.href}
            item={item}
            collapsed={collapsed}
            isActive={isItemActive(item.href)}
          />
        ))}
      </div>

      {/* ── Bottom: Settings + Disconnect + Wallet ───────────────── */}
      <div
        className="shrink-0 px-2 py-2 flex flex-col gap-1"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}
      >
        {BOTTOM_ITEMS.map((item) => (
          <NavLinkRow
            key={item.href}
            item={item}
            collapsed={collapsed}
            isActive={isItemActive(item.href)}
          />
        ))}

        {/* Disconnect button */}
        {onDisconnect && (
          <button
            type="button"
            onClick={onDisconnect}
            title={collapsed ? "Disconnect" : undefined}
            className={`flex items-center w-full rounded-md text-[var(--text-tertiary)] hover:bg-[var(--item-hover)] hover:text-[var(--danger)] transition-colors ${
              collapsed ? "justify-center p-1.5" : "gap-2 px-2.5 py-1.5"
            }`}
          >
            <LogOut style={{ width: 15, height: 15 }} strokeWidth={1.5} />
            {!collapsed && <span className="text-[12.5px]">Disconnect</span>}
          </button>
        )}

        {/* Wallet info row */}
        {!collapsed && (
          <div className="flex items-center gap-2.5 mt-1 px-2.5 py-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
            <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold bg-[var(--item-active-bg)] border border-[var(--border-strong)] text-[var(--text-primary)]">
              {address ? address.slice(2, 4).toUpperCase() : "0X"}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[11.5px] font-mono leading-none truncate text-[var(--text-primary)]">
                {short}
              </span>
              <span className="text-[9.5px] font-mono text-[var(--text-tertiary)] mt-0.5">
                Arbitrum One
              </span>
            </div>
            <button
              type="button"
              className="shrink-0 p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              title="Wallet options"
            >
              <MoreHorizontal style={{ width: 13, height: 13 }} strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SEARCH MODAL
   ══════════════════════════════════════════════════════════════════════════ */
export function SearchModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect?: (href: string) => void;
}) {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const allItems = [...MAIN_NAV_ITEMS, ...BOTTOM_ITEMS];
  const results = query.length > 0
    ? allItems.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : allItems;

  const handleSelect = (href: string) => {
    if (onSelect) {
      onSelect(href);
    } else {
      router.push(href);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4"
      style={{
        paddingTop: "12vh",
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div className="fixed inset-0" onClick={onClose} />
      <div className="relative w-full max-w-[500px] rounded-xl shadow-2xl overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-strong)]">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 border-b border-[var(--border)]">
          <Search className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" strokeWidth={1.5} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="flex-1 bg-transparent py-3 outline-none text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)]"
            placeholder="Search pages, protection layers, activity..."
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--item-hover)] transition-colors"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>

        {/* Results */}
        <div className="p-2 max-h-[280px] overflow-y-auto scrollbar-hide">
          {results.length > 0 ? (
            results.map((item) => (
              <button
                key={item.href}
                type="button"
                onClick={() => handleSelect(item.href)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--item-hover)] transition-colors"
              >
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[var(--bg-subtle)] border border-[var(--border)]">
                  <item.icon className="w-3.5 h-3.5 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                </div>
                <span className="text-[13px]">{item.label}</span>
                {item.badge && (
                  <span className="ml-auto text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-[var(--bg-subtle)] text-[var(--text-tertiary)] border border-[var(--border)]">
                    {item.badge}
                  </span>
                )}
              </button>
            ))
          ) : (
            <div className="py-8 flex flex-col items-center gap-2">
              <Command className="w-4 h-4 text-[var(--text-tertiary)]" strokeWidth={1.5} />
              <p className="text-[12px] text-[var(--text-tertiary)]">
                No results for &ldquo;{query}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* Hints */}
        <div className="px-4 py-2 flex items-center gap-4 border-t border-[var(--border)] bg-[var(--bg-subtle)]">
          {["↑↓ navigate", "↵ open", "esc close"].map((hint) => (
            <span key={hint} className="text-[10px] font-mono text-[var(--text-tertiary)]">
              {hint}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SidebarNav;

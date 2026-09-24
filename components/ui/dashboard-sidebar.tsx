"use client";

import React, { useState } from "react";
import {
  LayoutDashboard, ShieldCheck, Clock, Settings, LogOut,
  Search, MessageSquare, Bot, Hash, ChevronRight, X,
  Command, MoreHorizontal,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════════════════════ */
export type NavItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: string | number;
  shortcut?: string;
  children?: NavItem[];
};
type NavGroup = { heading?: string; items: NavItem[] };

/* ══════════════════════════════════════════════════════════════════════════
   NAV DATA
   ══════════════════════════════════════════════════════════════════════════ */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: "home",      label: "Overview",  icon: LayoutDashboard },
      {
        id: "positions", label: "Positions", icon: ShieldCheck,
        children: [
          { id: "pos-active",     label: "Active",     icon: Hash },
          { id: "pos-monitoring", label: "Monitoring", icon: Hash },
        ],
      },
      { id: "history", label: "History", icon: Clock },
    ],
  },
  {
    heading: "Intelligence",
    items: [
      { id: "chat", label: "AI Assistant", icon: MessageSquare, badge: "Soon" },
      { id: "bot",  label: "Telegram Bot", icon: Bot },
    ],
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { id: "settings", label: "Settings",    icon: Settings, shortcut: "⌘," },
  { id: "logout",   label: "Disconnect",  icon: LogOut },
];

/* ══════════════════════════════════════════════════════════════════════════
   NAV ROW
   ══════════════════════════════════════════════════════════════════════════ */
/* ── Tour target mapping ──────────────────────────────────────────────────── */
const TOUR_IDS: Record<string, string> = {
  home:     "tour-nav-home",
  positions:"tour-nav-positions",
  history:  "tour-nav-history",
  chat:     "tour-nav-chat",
  bot:      "tour-nav-bot",
  settings: "tour-nav-settings",
};

function NavRow({
  item, activeId, onSelect, level = 0, collapsed,
}: {
  item: NavItem;
  activeId: string;
  onSelect: (id: string) => void;
  level?: number;
  collapsed: boolean;
}) {
  const isActive    = activeId === item.id || (item.children?.some((c) => c.id === activeId) ?? false);
  const hasChildren = !!item.children;
  const [open, setOpen] = useState(isActive);

  const handleClick = () => {
    if (hasChildren) { setOpen((v) => !v); return; }
    onSelect(item.id);
  };

  return (
    <div className="flex flex-col w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => e.key === "Enter" && handleClick()}
        title={collapsed ? item.label : undefined}
        data-tour-id={TOUR_IDS[item.id]}
        className="relative flex items-center w-full rounded-[6px] cursor-pointer select-none outline-none transition-colors duration-100"
        style={{
          gap: collapsed ? 0 : 8,
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: collapsed ? 8 : level * 16 + 10,
          paddingRight: collapsed ? 8 : 8,
          justifyContent: collapsed ? "center" : "flex-start",
          backgroundColor: isActive && !hasChildren ? "var(--item-active-bg)" : undefined,
          color: isActive && !hasChildren ? "var(--item-active-text)" : "var(--text-secondary)",
        }}
        onMouseEnter={(e) => {
          if (!(isActive && !hasChildren)) {
            (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--item-hover)";
            (e.currentTarget as HTMLDivElement).style.color = "var(--text-primary)";
          }
        }}
        onMouseLeave={(e) => {
          if (!(isActive && !hasChildren)) {
            (e.currentTarget as HTMLDivElement).style.backgroundColor = "";
            (e.currentTarget as HTMLDivElement).style.color = "var(--text-secondary)";
          }
        }}
      >
        {/* Active left bar */}
        {isActive && !hasChildren && !collapsed && (
          <span
            className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full"
            style={{ backgroundColor: "#2dd4bf" }}
          />
        )}

        <item.icon
          style={{
            width: 15, height: 15,
            flexShrink: 0,
            color: isActive && !hasChildren ? "#2dd4bf" : "var(--text-tertiary)",
          }}
          strokeWidth={isActive && !hasChildren ? 2 : 1.5}
        />

        {!collapsed && (
          <>
            <span className="flex-1 text-[12.5px] tracking-[-0.01em] truncate leading-none">
              {item.label}
            </span>

            <div className="flex items-center gap-1 ml-auto shrink-0">
              {item.badge && (
                <span
                  className="inline-flex items-center h-4 px-1.5 rounded-[4px] text-[9px] font-bold font-mono tracking-wide"
                  style={{
                    backgroundColor: "var(--item-active-bg)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {item.badge}
                </span>
              )}
              {item.shortcut && (
                <kbd
                  className="hidden group-hover:inline-flex items-center h-4 px-1.5 text-[9px] font-mono rounded-[4px]"
                  style={{
                    color: "var(--text-tertiary)",
                    backgroundColor: "var(--bg-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {item.shortcut}
                </kbd>
              )}
              {hasChildren && (
                <ChevronRight
                  style={{
                    width: 12, height: 12,
                    color: "var(--text-tertiary)",
                    transform: open ? "rotate(90deg)" : undefined,
                    transition: "transform 0.2s",
                  }}
                  strokeWidth={2}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Children */}
      {hasChildren && !collapsed && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-200 ease-in-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
        >
          <div className="overflow-hidden min-h-0 relative flex flex-col gap-0.5 mt-0.5">
            <div
              className="absolute top-0 bottom-0 w-px"
              style={{
                left: level * 16 + 18,
                backgroundColor: "var(--border)",
              }}
            />
            {item.children!.map((child) => (
              <NavRow
                key={child.id}
                item={child}
                activeId={activeId}
                onSelect={onSelect}
                level={level + 1}
                collapsed={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SIDEBAR NAV
   ══════════════════════════════════════════════════════════════════════════ */
export function SidebarNav({
  activeId = "home",
  onSelect,
  address,
  onDisconnect,
  collapsed = false,
}: {
  activeId?: string;
  onSelect?: (id: string) => void;
  address?: string;
  onDisconnect?: () => void;
  collapsed?: boolean;
}) {
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";

  const handleSelect = (id: string) => {
    if (id === "logout") { onDisconnect?.(); return; }
    onSelect?.(id);
  };

  return (
    <nav
      className="flex flex-col h-full overflow-hidden"
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
        {collapsed ? (
          <div
            data-tour-id="tour-logo"
            className="w-7 h-7 rounded-[6px] flex items-center justify-center"
            style={{
              background: "rgba(45,212,191,0.1)",
              border: "1px solid rgba(45,212,191,0.25)",
            }}
          >
            <ShieldCheck style={{ width: 14, height: 14, color: "#2dd4bf" }} strokeWidth={1.5} />
          </div>
        ) : (
          <div data-tour-id="tour-logo" className="flex items-center gap-2.5">
            <div
              className="w-[28px] h-[28px] rounded-[6px] flex items-center justify-center shrink-0"
              style={{
                background: "rgba(45,212,191,0.1)",
                border: "1px solid rgba(45,212,191,0.25)",
              }}
            >
              <ShieldCheck style={{ width: 14, height: 14, color: "#2dd4bf" }} strokeWidth={1.5} />
            </div>
            <div className="flex flex-col">
              <span
                className="text-[13px] font-semibold leading-none tracking-[-0.02em]"
                style={{ color: "var(--text-primary)" }}
              >
                Tahansoe
              </span>
              <span
                className="text-[10px] leading-none mt-0.5 font-mono"
                style={{ color: "#2dd4bf", opacity: 0.6 }}
              >
                Risk Automation
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Nav groups ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide px-2 py-3 flex flex-col gap-5">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className="flex flex-col gap-0.5">
            {group.heading && !collapsed && (
              <div className="px-2 pb-1 pt-0.5">
                <span
                  className="text-[10px] font-semibold tracking-[0.08em] uppercase"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {group.heading}
                </span>
              </div>
            )}
            {group.items.map((item) => (
              <NavRow
                key={item.id}
                item={item}
                activeId={activeId}
                onSelect={handleSelect}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </div>

      {/* ── Bottom: settings + wallet ─────────────────────────── */}
      <div
        className="shrink-0 px-2 py-2 flex flex-col gap-0.5"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}
      >
        {BOTTOM_ITEMS.map((item) => (
          <NavRow
            key={item.id}
            item={item}
            activeId={activeId}
            onSelect={handleSelect}
            collapsed={collapsed}
          />
        ))}

        {/* Wallet identity row */}
        {!collapsed && (
          <div
            className="flex items-center gap-2.5 mt-1.5 px-2.5 py-2 rounded-[8px]"
            style={{
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
            }}
          >
            {/* Avatar */}
            <div
              className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold"
              style={{
                background: "var(--item-active-bg)",
                border: "1px solid var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              {address ? address.slice(2, 4).toUpperCase() : "?"}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span
                className="text-[11.5px] font-medium leading-none truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {short}
              </span>
              {/* <div className="flex items-center gap-1 mt-0.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "var(--safe)" }}
                />
                <span
                  className="text-[10px] font-mono leading-none"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  Base · Connected
                </span>
              </div> */}
            </div>
            <button
              className="shrink-0 p-1 rounded-[4px] transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
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
   FLAT ITEMS FOR SEARCH
   ══════════════════════════════════════════════════════════════════════════ */
const flattenItems = (items: NavItem[]): NavItem[] =>
  items.reduce((acc, item) => {
    acc.push(item);
    if (item.children) acc.push(...flattenItems(item.children));
    return acc;
  }, [] as NavItem[]);

export const flatNavItems = flattenItems([
  ...NAV_GROUPS.flatMap((g) => g.items),
  ...BOTTOM_ITEMS,
]);

/* ══════════════════════════════════════════════════════════════════════════
   SEARCH MODAL
   ══════════════════════════════════════════════════════════════════════════ */
export function SearchModal({
  onClose, onSelect,
}: {
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = query.length > 0
    ? flatNavItems.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : flatNavItems.filter((i) => !["pos-active", "pos-monitoring", "logout"].includes(i.id));

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center px-4"
      style={{ paddingTop: "12vh", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="relative w-full max-w-[520px] rounded-[12px] shadow-2xl overflow-hidden"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
        }}
      >
        {/* Input row */}
        <div
          className="flex items-center gap-3 px-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Search style={{ width: 14, height: 14, color: "var(--text-tertiary)", flexShrink: 0 }} strokeWidth={1.5} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="flex-1 bg-transparent py-3.5 outline-none text-[13px]"
            style={{ color: "var(--text-primary)" }}
            placeholder="Search pages and actions..."
          />
          <button
            onClick={onClose}
            className="p-1 rounded-[5px] transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--item-hover)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-tertiary)";
            }}
          >
            <X style={{ width: 13, height: 13 }} strokeWidth={1.5} />
          </button>
        </div>

        {/* Results */}
        <div className="p-2 max-h-[300px] overflow-y-auto scrollbar-hide">
          {!query && (
            <p
              className="px-3 py-1.5 text-[10px] font-semibold tracking-[0.08em] uppercase"
              style={{ color: "var(--text-tertiary)" }}
            >
              Quick access
            </p>
          )}

          {results.length > 0 ? results.map((item) => (
            <button
              key={item.id}
              onClick={() => { onSelect(item.id); onClose(); }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-[7px] text-left transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--item-hover)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
              }}
            >
              <div
                className="w-6 h-6 rounded-[6px] flex items-center justify-center shrink-0"
                style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
              >
                <item.icon style={{ width: 13, height: 13, color: "var(--text-tertiary)" }} strokeWidth={1.5} />
              </div>
              <span className="text-[13px]">{item.label}</span>
              {item.shortcut && (
                <kbd
                  className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded-[4px]"
                  style={{
                    color: "var(--text-tertiary)",
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {item.shortcut}
                </kbd>
              )}
            </button>
          )) : (
            <div className="py-8 flex flex-col items-center gap-2">
              <Command style={{ width: 18, height: 18, color: "var(--text-tertiary)" }} strokeWidth={1.5} />
              <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                No results for &ldquo;{query}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div
          className="px-4 py-2 flex items-center gap-4"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          {["↑↓ navigate", "↵ open", "esc close"].map((hint) => (
            <span key={hint} className="text-[10px] font-mono" style={{ color: "var(--text-tertiary)" }}>
              {hint}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SidebarNav;

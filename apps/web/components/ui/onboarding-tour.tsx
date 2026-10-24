"use client";

/**
 * OnboardingTour
 *
 * App-tour shown to first-time users on dashboard entry.
 * - 7 steps covering the 3 protection layers and 2 AI agents
 * - Spotlight overlay that highlights a target DOM element via data-tour-id attribute
 * - Persists "completed" flag to localStorage so it never re-shows
 * - Can be re-triggered from any page via `useTour().restart()`
 */

import React, {
  createContext, useCallback, useContext,
  useEffect, useRef, useState,
} from "react";
import {
  ArrowRight, X, ShieldCheck, LayoutDashboard, Clock,
  Sparkles, Send, Settings, CheckCircle, ChevronLeft, ChevronRight,
} from "lucide-react";

/* ─────────────────────────────────────────────
   Tour step definitions
───────────────────────────────────────────── */
export interface TourStep {
  id:           string;
  targetId:     string;          // matches data-tour-id="…" on DOM element
  title:        string;
  description:  string;
  icon:         import("lucide-react").LucideIcon;
  badge?:       string;          // optional pill label
  action?:      string;          // call-to-action text
  placement:    "right" | "left" | "bottom" | "top" | "center";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id:          "welcome",
    targetId:    "tour-logo",
    title:       "Welcome to Tahansoe",
    description: "Tahansoe protects your Aave and Morpho positions with 3 self-approved liquidation defense layers and 2 AI agents. Rules execute deterministically — AI never signs transactions.",
    icon:        ShieldCheck,
    badge:       "Start here",
    action:      "Take the tour",
    placement:   "center",
  },
  {
    id:          "overview",
    targetId:    "tour-nav-home",
    title:       "Overview",
    description: "Your live command center. See your Health Factor, risk zone, live ETH price ticker, and instant layer readiness.",
    icon:        LayoutDashboard,
    badge:       "Dashboard",
    placement:   "right",
  },
  {
    id:          "protection",
    targetId:    "tour-nav-protection",
    title:       "3 Protection Layers",
    description: "Layer 1 (Wallet Reserve) repays from idle USDC. Layer 2 (Position Reserve) redeems secondary vault shares. Layer 3 (Flash Deleverage) executes an atomic flash loan. You set the caps and approve each layer.",
    icon:        ShieldCheck,
    badge:       "Core Defense",
    action:      "View Layers →",
    placement:   "right",
  },
  {
    id:          "activity",
    targetId:    "tour-nav-activity",
    title:       "Execution Activity",
    description: "Full audit trail of every remediation. Inspect which layer fired, before and after Health Factors, gas consumed, and verifiable on-chain transaction hashes.",
    icon:        Clock,
    placement:   "right",
  },
  {
    id:          "agents",
    targetId:    "tour-nav-agents",
    title:       "AI Agents",
    description: "Two specialized agents: Market Pulse delivers daily research briefs, while HF Sentinel continuously watches your positions and provides plain-English risk explanations.",
    icon:        Sparkles,
    badge:       "2 Active",
    placement:   "right",
  },
  {
    id:          "telegram",
    targetId:    "tour-nav-telegram",
    title:       "Telegram Alerts",
    description: "Connect your Telegram account to receive instant push alerts when your Health Factor enters warning territory or when a protection layer triggers.",
    icon:        Send,
    badge:       "Recommended",
    action:      "Connect Telegram →",
    placement:   "right",
  },
  {
    id:          "settings",
    targetId:    "tour-nav-settings",
    title:       "Settings & Thresholds",
    description: "Customize your trigger HF (e.g. 1.30), target HF (e.g. 1.60), slippage limits, and notification toggles.",
    icon:        Settings,
    action:      "You're all set!",
    placement:   "right",
  },
];

const STORAGE_KEY = "tahansoe:tour:completed";

/* ─────────────────────────────────────────────
   Tour context
───────────────────────────────────────────── */
type TourContextValue = {
  isOpen:  boolean;
  step:    number;
  restart: () => void;
  close:   () => void;
};

const TourCtx = createContext<TourContextValue>({
  isOpen: false, step: 0, restart: () => {}, close: () => {},
});

export function useTour() { return useContext(TourCtx); }

/* ─────────────────────────────────────────────
   Spotlight rect helper
───────────────────────────────────────────── */
type Rect = { top: number; left: number; width: number; height: number };

function getTargetRect(targetId: string): Rect | null {
  const el = document.querySelector(`[data-tour-id="${targetId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/* ─────────────────────────────────────────────
   Popover card positioning
───────────────────────────────────────────── */
function getCardStyle(
  rect: Rect | null,
  placement: TourStep["placement"]
): React.CSSProperties {
  if (!rect || placement === "center") {
    return {
      position: "fixed",
      top:      "50%",
      left:     "50%",
      transform: "translate(-50%, -50%)",
      zIndex:   9999,
    };
  }

  const PAD = 16;
  const vw  = window.innerWidth;
  const vh  = window.innerHeight;

  switch (placement) {
    case "right":
      return {
        position: "fixed",
        top:      Math.min(vh - 280, Math.max(PAD, rect.top + rect.height / 2 - 120)),
        left:     Math.min(vw - 340, rect.left + rect.width + PAD),
        zIndex:   9999,
      };
    case "bottom":
      return {
        position: "fixed",
        top:      Math.min(vh - 280, rect.top + rect.height + PAD),
        left:     Math.min(vw - 340, Math.max(PAD, rect.left + rect.width / 2 - 160)),
        zIndex:   9999,
      };
    default:
      return {
        position: "fixed",
        top:      "50%",
        left:     "50%",
        transform: "translate(-50%, -50%)",
        zIndex:   9999,
      };
  }
}

/* ─────────────────────────────────────────────
   Spotlight overlay (SVG cutout)
───────────────────────────────────────────── */
function SpotlightOverlay({
  rect,
  onClick,
}: {
  rect: Rect | null;
  onClick: () => void;
}) {
  const PAD = 8;
  const vw  = typeof window !== "undefined" ? window.innerWidth  : 1920;
  const vh  = typeof window !== "undefined" ? window.innerHeight : 1080;

  if (!rect) {
    return (
      <div
        className="fixed inset-0 z-[9990]"
        style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(2px)" }}
        onClick={onClick}
      />
    );
  }

  const x = rect.left   - PAD;
  const y = rect.top    - PAD;
  const w = rect.width  + PAD * 2;
  const h = rect.height + PAD * 2;
  const r = 8;

  const clipPath = `
    M 0 0 L ${vw} 0 L ${vw} ${vh} L 0 ${vh} Z
    M ${x + r} ${y}
    L ${x + w - r} ${y}
    Q ${x + w} ${y} ${x + w} ${y + r}
    L ${x + w} ${y + h - r}
    Q ${x + w} ${y + h} ${x + w - r} ${y + h}
    L ${x + r} ${y + h}
    Q ${x} ${y + h} ${x} ${y + h - r}
    L ${x} ${y + r}
    Q ${x} ${y} ${x + r} ${y}
    Z
  `;

  return (
    <svg
      className="fixed inset-0 z-[9990] pointer-events-none"
      style={{ width: vw, height: vh }}
    >
      <defs>
        <clipPath id="tour-cutout">
          <path d={clipPath} fillRule="evenodd" />
        </clipPath>
      </defs>
      <rect
        width={vw}
        height={vh}
        fill="rgba(0,0,0,0.72)"
        clipPath="url(#tour-cutout)"
      />
      {/* glow ring around target */}
      <rect
        x={x} y={y} width={w} height={h} rx={r}
        fill="none"
        stroke="var(--brand)"
        strokeWidth={1.5}
      />
      {/* click-through blocker outside spotlight */}
      <rect
        width={vw}
        height={vh}
        fill="transparent"
        className="pointer-events-auto"
        onClick={onClick}
        clipPath="url(#tour-cutout)"
      />
    </svg>
  );
}

/* ─────────────────────────────────────────────
   Tour card
───────────────────────────────────────────── */
function TourCard({
  step,
  total,
  onNext,
  onPrev,
  onClose,
  onAction,
  cardStyle,
}: {
  step:       TourStep;
  total:      number;
  onNext:     () => void;
  onPrev:     () => void;
  onClose:    () => void;
  onAction:   () => void;
  cardStyle:  React.CSSProperties;
}) {
  const stepIdx  = TOUR_STEPS.indexOf(step);
  const isFirst  = stepIdx === 0;
  const isLast   = stepIdx === total - 1;
  const Icon     = step.icon;
  const pct      = ((stepIdx + 1) / total) * 100;

  return (
    <div
      style={{
        ...cardStyle,
        width: 320,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 14,
        boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 20px rgba(43,118,255,0.12)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Progress bar */}
      <div
        className="h-[3px] rounded-t-[14px] transition-all duration-500"
        style={{
          background: `linear-gradient(90deg, var(--brand) 0%, var(--brand) ${pct}%, var(--border) ${pct}%)`,
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-[7px] flex items-center justify-center"
            style={{
              background: "var(--brand-bg)",
              border: "1px solid var(--border-strong)",
            }}
          >
            <Icon style={{ width: 14, height: 14, color: "var(--brand)" }} strokeWidth={1.8} />
          </div>
          {step.badge && (
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-mono font-medium tracking-wide"
              style={{
                background: "var(--brand-bg)",
                border: "1px solid var(--border)",
                color: "var(--brand)",
              }}
            >
              {step.badge}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
            {stepIdx + 1} / {total}
          </span>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1 rounded-md"
            aria-label="Close walkthrough"
          >
            <X style={{ width: 13, height: 13 }} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-2">
        <h3 className="text-[14px] font-semibold text-[var(--text-primary)] leading-snug tracking-[-0.01em]">
          {step.title}
        </h3>
        <p className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
          {step.description}
        </p>
      </div>

      {/* Step dot indicators */}
      <div className="flex items-center gap-1 px-5 py-2">
        {TOUR_STEPS.map((_, i) => (
          <span
            key={i}
            className="rounded-full transition-all duration-300"
            style={{
              width: i === stepIdx ? 16 : 5,
              height: 5,
              background: i === stepIdx
                ? "var(--brand)"
                : i < stepIdx
                ? "var(--text-tertiary)"
                : "var(--border)",
            }}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 pb-4 pt-1">
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--item-hover)] transition-colors disabled:opacity-0"
        >
          <ChevronLeft style={{ width: 13, height: 13 }} strokeWidth={2} />
          Back
        </button>

        {isLast ? (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 h-8 px-4 rounded-md text-[12px] font-medium bg-[var(--brand)] text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            <CheckCircle style={{ width: 13, height: 13 }} strokeWidth={2.5} />
            {step.action ?? "Done"}
          </button>
        ) : (
          <button
            onClick={step.action ? onAction : onNext}
            className="flex items-center gap-1.5 h-8 px-4 rounded-md text-[12px] font-medium bg-[var(--brand)] text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            {step.action ?? "Next"}
            {!step.action && <ChevronRight style={{ width: 13, height: 13 }} strokeWidth={2.5} />}
            {step.action  && <ArrowRight   style={{ width: 13, height: 13 }} strokeWidth={2.5} />}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Provider + main component
───────────────────────────────────────────── */
export function OnboardingTourProvider({
  children,
  onNavigate,
  autoOpen = true,
}: {
  children:    React.ReactNode;
  onNavigate?: (path: string) => void;
  /** False skips the first-visit auto-open (e.g. Simulation Mode has its own guided flow). */
  autoOpen?:   boolean;
}) {
  const [isOpen,  setIsOpen]  = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect,    setRect]    = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  /* Auto-open for first-time visitors */
  useEffect(() => {
    if (!autoOpen) return;
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) {
      /* Small delay so the dashboard has rendered */
      const t = setTimeout(() => setIsOpen(true), 900);
      return () => clearTimeout(t);
    }
  }, [autoOpen]);

  /* Update spotlight rect each animation frame while open */
  useEffect(() => {
    if (!isOpen) return;
    const step = TOUR_STEPS[stepIdx];

    const track = () => {
      setRect(getTargetRect(step.targetId));
      rafRef.current = requestAnimationFrame(track);
    };
    rafRef.current = requestAnimationFrame(track);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isOpen, stepIdx]);

  const close = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem(STORAGE_KEY, "1");
  }, []);

  const restart = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setStepIdx(0);
    setIsOpen(true);
  }, []);

  const goNext = useCallback(() => {
    setStepIdx((i) => Math.min(i + 1, TOUR_STEPS.length - 1));
  }, []);

  const goPrev = useCallback(() => {
    setStepIdx((i) => Math.max(i - 1, 0));
  }, []);

  /* Action button: navigate to a relevant page */
  const handleAction = useCallback(() => {
    const step = TOUR_STEPS[stepIdx];
    if (step.id === "protection") onNavigate?.("/dashboard/protection");
    if (step.id === "telegram")   onNavigate?.("/dashboard/telegram");
    if (step.id === "settings")   onNavigate?.("/dashboard/settings");
    goNext();
  }, [stepIdx, onNavigate, goNext]);

  const step      = TOUR_STEPS[stepIdx];
  const cardStyle = rect ? getCardStyle(rect, step.placement) : getCardStyle(null, "center");

  return (
    <TourCtx.Provider value={{ isOpen, step: stepIdx, restart, close }}>
      {children}

      {isOpen && (
        <>
          <SpotlightOverlay rect={step.placement === "center" ? null : rect} onClick={close} />
          <TourCard
            step={step}
            total={TOUR_STEPS.length}
            onNext={goNext}
            onPrev={goPrev}
            onClose={close}
            onAction={handleAction}
            cardStyle={cardStyle}
          />
        </>
      )}
    </TourCtx.Provider>
  );
}

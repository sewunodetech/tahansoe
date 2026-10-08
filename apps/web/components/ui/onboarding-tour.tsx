"use client";

/**
 * OnboardingTour
 *
 * App-tour shown to first-time users on dashboard entry.
 * - 8 steps covering every key section
 * - Spotlight overlay that highlights a target DOM element via data-tour-id attribute
 * - Persists "completed" flag to localStorage so it never re-shows
 * - Can be re-triggered from any page via `useTour().restart()`
 */

import React, {
  createContext, useCallback, useContext,
  useEffect, useRef, useState,
} from "react";
import {
  ArrowRight, X, ShieldCheck, LayoutDashboard, Activity,
  Clock, MessageSquare, Bot, Settings, Bell, Zap,
  ChevronLeft, ChevronRight, CheckCircle,
} from "lucide-react";

/* ─────────────────────────────────────────────
   Tour step definitions
───────────────────────────────────────────── */
export interface TourStep {
  id:           string;
  targetId:     string;          // matches data-tour-id="…" on DOM element
  title:        string;
  description:  string;
  icon:         React.ElementType;
  badge?:       string;          // optional pill label
  action?:      string;          // call-to-action text
  placement:    "right" | "left" | "bottom" | "top" | "center";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id:          "welcome",
    targetId:    "tour-logo",
    title:       "Welcome to Tahansoe",
    description: "Tahansoe is your autonomous DeFi risk manager. It monitors your lending positions 24/7 and automatically executes protective actions — repays, collateral top-ups, flash loans — the moment your Health Factor approaches liquidation territory.",
    icon:        ShieldCheck,
    badge:       "Start here",
    action:      "Take the tour",
    placement:   "center",
  },
  {
    id:          "overview",
    targetId:    "tour-nav-home",
    title:       "Overview",
    description: "Your command center. At a glance you'll see total collateral, active debt, Health Factor trends for the last 24 hours, and a real-time feed of recent Tahansoe executions.",
    icon:        LayoutDashboard,
    badge:       "Dashboard",
    placement:   "right",
  },
  {
    id:          "positions",
    targetId:    "tour-nav-positions",
    title:       "Positions",
    description: "Every Aave V3 and Morpho Blue position you own is listed here with a live Health Factor bar. The yellow marker shows your trigger threshold — when HF touches it, Tahansoe fires automatically. Click any position for a detailed HF trend chart.",
    icon:        Activity,
    badge:       "Core feature",
    placement:   "right",
  },
  {
    id:          "hf-chart",
    targetId:    "tour-hf-chart",
    title:       "Live Health Factor Chart",
    description: "This chart updates in real time as ETH price moves. The dashed yellow line is your trigger threshold (1.30 by default). Watch both positions drift — when either line hits the threshold, Tahansoe intervenes automatically.",
    icon:        Activity,
    badge:       "Live",
    placement:   "bottom",
  },
  {
    id:          "history",
    targetId:    "tour-nav-history",
    title:       "Execution History",
    description: "Every action Tahansoe has taken — repays, collateral supplies, flash loans — is logged here with before/after Health Factors, gas used, and on-chain tx hashes. This is your full audit trail.",
    icon:        Clock,
    placement:   "right",
  },
  {
    id:          "telegram",
    targetId:    "tour-nav-bot",
    title:       "Telegram Alerts",
    description: "Connect your Telegram account to receive instant push notifications whenever Tahansoe detects a warning, fires a trigger, or completes an execution. This is the most important step for staying safe — do it now.",
    icon:        Bot,
    badge:       "Recommended",
    action:      "Connect Telegram →",
    placement:   "right",
  },
  {
    id:          "ai-chat",
    targetId:    "tour-nav-chat",
    title:       "AI Assistant",
    description: "Ask your AI assistant anything about your positions in plain English — \"What's my riskiest position?\", \"How does the flash loan fallback work?\", \"What happened in the last execution?\". It has full context of your portfolio.",
    icon:        MessageSquare,
    badge:       "AI",
    placement:   "right",
  },
  {
    id:          "settings",
    targetId:    "tour-nav-settings",
    title:       "Settings & Thresholds",
    description: "Customize your trigger HF (when Tahansoe fires), target HF (what it restores to), and execution strategy — flash loans, hot reserve, deleverage. Set these once and Tahansoe handles the rest autonomously.",
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
        top:      Math.min(rect.top, vh - 320),
        left:     Math.min(rect.left + rect.width + PAD, vw - 340),
        zIndex:   9999,
      };
    case "left":
      return {
        position: "fixed",
        top:      Math.min(rect.top, vh - 320),
        right:    vw - rect.left + PAD,
        zIndex:   9999,
      };
    case "bottom":
      return {
        position: "fixed",
        top:      Math.min(rect.top + rect.height + PAD, vh - 320),
        left:     Math.max(PAD, Math.min(rect.left, vw - 340)),
        zIndex:   9999,
      };
    case "top":
      return {
        position: "fixed",
        bottom:   vh - rect.top + PAD,
        left:     Math.max(PAD, Math.min(rect.left, vw - 340)),
        zIndex:   9999,
      };
  }
}

/* ─────────────────────────────────────────────
   SVG spotlight overlay
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
        stroke="rgba(74,181,224,0.5)"
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
        width:    320,
        background: "rgba(13,14,17,0.97)",
        border:   "1px solid rgba(74,181,224,0.2)",
        borderRadius: 14,
        boxShadow: "0 0 0 1px rgba(74,181,224,0.06), 0 24px 64px rgba(0,0,0,0.7), 0 0 40px rgba(74,181,224,0.08)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Progress bar */}
      <div
        className="h-[3px] rounded-t-[14px] transition-all duration-500"
        style={{
          background: `linear-gradient(90deg, #4ab5e0 0%, #2f8fb8 ${pct}%, rgba(253,241,225,0.06) ${pct}%)`,
        }}
      />

      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
            style={{
              background: "rgba(74,181,224,0.1)",
              border:     "1px solid rgba(74,181,224,0.25)",
            }}
          >
            <Icon style={{ width: 17, height: 17, color: "#4ab5e0" }} strokeWidth={1.5} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-white tracking-[-0.01em]">
                {step.title}
              </span>
              {step.badge && (
                <span
                  className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-[4px] tracking-wide"
                  style={{
                    background: "rgba(74,181,224,0.12)",
                    border:     "1px solid rgba(74,181,224,0.25)",
                    color:      "#4ab5e0",
                  }}
                >
                  {step.badge}
                </span>
              )}
            </div>
            <p className="text-[10px] font-mono text-white/25 mt-0.5">
              Step {stepIdx + 1} of {total}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-[5px] flex items-center justify-center text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-colors shrink-0"
        >
          <X style={{ width: 12, height: 12 }} strokeWidth={2} />
        </button>
      </div>

      {/* Body */}
      <div className="px-5 pb-4">
        <p className="text-[12.5px] text-white/55 leading-[1.7]">
          {step.description}
        </p>
      </div>

      {/* Dot progress */}
      <div className="flex items-center justify-center gap-1.5 pb-3">
        {TOUR_STEPS.map((_, i) => (
          <span
            key={i}
            className="rounded-full transition-all duration-300"
            style={{
              width:  i === stepIdx ? 16 : 5,
              height: 5,
              background: i === stepIdx
                ? "#4ab5e0"
                : i < stepIdx
                ? "rgba(74,181,224,0.3)"
                : "rgba(253,241,225,0.1)",
            }}
          />
        ))}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-5 pb-4"
      >
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="flex items-center gap-1.5 h-8 px-3 rounded-[7px] text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-colors disabled:opacity-0"
        >
          <ChevronLeft style={{ width: 13, height: 13 }} strokeWidth={2} />
          Back
        </button>

        {isLast ? (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 h-8 px-4 rounded-[7px] text-[12px] font-semibold transition-all"
            style={{
              background: "linear-gradient(135deg, #4ab5e0 0%, #2f8fb8 100%)",
              color:      "#0e2a36",
            }}
          >
            <CheckCircle style={{ width: 13, height: 13 }} strokeWidth={2.5} />
            {step.action ?? "Done"}
          </button>
        ) : (
          <button
            onClick={step.action ? onAction : onNext}
            className="flex items-center gap-1.5 h-8 px-4 rounded-[7px] text-[12px] font-semibold transition-all"
            style={{
              background: "linear-gradient(135deg, #4ab5e0 0%, #2f8fb8 100%)",
              color:      "#0e2a36",
            }}
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
}: {
  children:    React.ReactNode;
  onNavigate?: (pageId: string) => void;
}) {
  const [isOpen,  setIsOpen]  = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect,    setRect]    = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  /* Auto-open for first-time visitors */
  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) {
      /* Small delay so the dashboard has rendered */
      const t = setTimeout(() => setIsOpen(true), 900);
      return () => clearTimeout(t);
    }
  }, []);

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
    if (step.id === "telegram")  onNavigate?.("bot");
    if (step.id === "settings")  onNavigate?.("settings");
    if (step.id === "welcome")   {} // just go next
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

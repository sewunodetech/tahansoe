"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useAccount } from "wagmi";
import { CyclingWord } from "@/components/ui/cycling-word";
import { LayoutDashboard } from "lucide-react";

const EASE = [0.16, 1, 0.3, 1] as const;

const ACTIVITY_WORDS = ["sleep.", "work.", "eat.", "trade.", "travel.", "rest."];

export function HeroCopy() {
  const reduce = useReducedMotion();
  const { isConnected } = useAccount();

  return (
    <div className="flex flex-col gap-8">

      {/* Headline */}
      <motion.h1
        className="font-medium leading-[1.06] tracking-[-0.03em] text-5xl md:text-[58px] lg:text-[68px]"
        style={{ overflow: "visible" }}
        initial={reduce ? undefined : { opacity: 0, y: 24 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
      >
        <span className="text-white block">Your positions.</span>
        <span
          className="block"
          style={{
            background: "linear-gradient(90deg, #ffffff 0%, #2dd4bf 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          Protected while
        </span>
        <span className="block" style={{ overflow: "visible" }}>
          <span className="text-white/35">you </span>
          {reduce ? (
            <span className="text-white/35">sleep.</span>
          ) : (
            <CyclingWord words={ACTIVITY_WORDS} interval={2200} className="text-white/35" />
          )}
        </span>
      </motion.h1>

      {/* Subtext */}
      <motion.p
        className="text-[15px] leading-[1.7] text-white/40 max-w-[420px]"
        initial={reduce ? undefined : { opacity: 0, y: 16 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.35, ease: EASE }}
      >
        Tahansoe monitors your Health Factor 24/7 and executes automatic repay
        or collateral top-up before liquidation strikes. Non-custodial. No
        reserve required.
      </motion.p>

      {/* CTAs */}
      <motion.div
        className="flex flex-wrap items-center gap-3"
        initial={reduce ? undefined : { opacity: 0, y: 12 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.55, ease: EASE }}
      >
        {isConnected ? (
          /* Already connected — go straight to dashboard */
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 h-10 px-6 rounded-[6px] bg-white text-[#080808] text-[13px] font-semibold tracking-[-0.01em] select-none hover:bg-white/90 transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" strokeWidth={2} />
            Open Dashboard
          </Link>
        ) : (
          <>
            <Link
              href="/connect"
              className="inline-flex items-center justify-center h-10 px-6 rounded-[6px] text-[13px] font-semibold tracking-[-0.01em] select-none transition-colors"
              style={{
                background: "linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)",
                color: "#042f2e",
              }}
            >
              Launch app
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center h-10 px-6 rounded-[6px] border border-white/10 text-white/50 text-[13px] font-medium tracking-[-0.01em] select-none hover:text-white/80 hover:border-white/25 transition-colors duration-200"
            >
              How it works
            </a>
          </>
        )}
      </motion.div>

      {/* Disclaimer */}
      <motion.p
        className="text-[11px] text-white/20 font-mono"
        initial={reduce ? undefined : { opacity: 0 }}
        animate={reduce ? undefined : { opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.8 }}
      >
        Risk automation — not a liquidation guarantee.
      </motion.p>
    </div>
  );
}

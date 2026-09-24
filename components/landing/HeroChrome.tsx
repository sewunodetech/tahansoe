"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

const BAR_HEIGHTS = [4, 8, 12, 6, 16, 10, 5, 13, 7, 10];
const NAV_H = 64; // matches Navbar h-16

export function HeroChrome() {
  const reduce = useReducedMotion();
  const [block, setBlock] = useState(21_847_340);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setBlock((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % 9999), 80);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <>
      {/* ── Thin sub-navbar data strip ───────────────────────────── */}
      <div
        className="absolute left-0 right-0 z-40 pointer-events-none"
        style={{ top: NAV_H }}
      >
        <div className="border-b border-white/[0.07] bg-gradient-to-r from-black/80 via-black/40 to-black/80 backdrop-blur-sm">
          <div className="max-w-[1400px] mx-auto px-8 h-8 flex items-center justify-between">
            <div className="flex items-center gap-4 font-mono text-[9px] text-white/40 tracking-[0.12em]">
              {/* Live indicator */}
              <span className="flex items-center gap-1.5">
                <motion.span
                  className="w-[5px] h-[5px] rounded-full bg-emerald-400"
                  animate={reduce ? undefined : { opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                LIVE
              </span>
              <span className="text-white/20">|</span>
              <span>BLK&nbsp;#{block.toLocaleString()}</span>
              <span className="text-white/20">|</span>
              <span className="hidden sm:inline">CHAIN: BASE 8453</span>
            </div>
            <div className="hidden md:flex items-center gap-4 font-mono text-[9px] text-white/30 tracking-[0.1em]">
              <span>AAVE V3</span>
              <span className="text-white/15">·</span>
              <span>MORPHO BLUE</span>
              <span className="text-white/15">·</span>
              <span>CHAINLINK AUTOMATION</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Corner brackets — all four ───────────────────────────── */}
      {/* Top-left: anchored below the sub-strip */}
      <div
        className="absolute z-30 pointer-events-none"
        style={{ top: NAV_H + 32, left: 0 }}
        aria-hidden="true"
      >
        <div className="w-[48px] h-[48px] border-t border-l border-white/30" />
      </div>
      {/* Top-right */}
      <div
        className="absolute z-30 pointer-events-none"
        style={{ top: NAV_H + 32, right: 0 }}
        aria-hidden="true"
      >
        <div className="w-[48px] h-[48px] border-t border-r border-white/30" />
      </div>
      {/* Bottom-left */}
      <div
        className="absolute z-30 pointer-events-none"
        style={{ bottom: 48, left: 0 }}
        aria-hidden="true"
      >
        <div className="w-[48px] h-[48px] border-b border-l border-white/30" />
      </div>
      {/* Bottom-right */}
      <div
        className="absolute z-30 pointer-events-none"
        style={{ bottom: 48, right: 0 }}
        aria-hidden="true"
      >
        <div className="w-[48px] h-[48px] border-b border-r border-white/30" />
      </div>

      {/* ── Left edge ruler ticks ────────────────────────────────── */}
      <div
        className="absolute left-0 z-30 pointer-events-none hidden lg:flex flex-col gap-0"
        style={{ top: NAV_H + 90, bottom: 60 }}
        aria-hidden="true"
      >
        {Array.from({ length: 22 }).map((_, i) => (
          <div
            key={i}
            style={{
              width: i % 5 === 0 ? 14 : i % 2 === 0 ? 8 : 5,
              height: 1,
              marginBottom: 16,
              backgroundColor: `rgba(253,241,225,${i % 5 === 0 ? 0.22 : 0.1})`,
            }}
          />
        ))}
      </div>

      {/* ── Right dither column ──────────────────────────────────── */}
      <div
        className="absolute z-30 pointer-events-none hidden lg:block"
        style={{
          right: 18,
          top: NAV_H + 90,
          bottom: 60,
          width: 1,
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(253,241,225,0.25) 0px, rgba(253,241,225,0.25) 2px, transparent 2px, transparent 6px)",
        }}
        aria-hidden="true"
      />

      {/* ── Bottom status bar ────────────────────────────────────── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-40 pointer-events-none border-t border-white/[0.08]"
        style={{ height: 48 }}
      >
        <div className="h-full bg-gradient-to-r from-black/90 via-black/60 to-black/90 backdrop-blur-sm">
          <div className="max-w-[1400px] mx-auto px-8 h-full flex items-center justify-between">

            {/* Left: system status + animated waveform */}
            <div className="flex items-center gap-5 font-mono text-[9px] text-white/35 tracking-[0.12em]">
              <span className="hidden sm:inline uppercase">System.Active</span>
              <div className="hidden md:flex items-end gap-[2px] h-[18px]">
                {BAR_HEIGHTS.map((h, i) => (
                  <motion.div
                    key={i}
                    className="rounded-[1px]"
                    style={{ width: 2.5, backgroundColor: "rgba(253,241,225,0.35)" }}
                    animate={
                      reduce
                        ? undefined
                        : {
                            height: [h, Math.max(2, h - 5), h + 2, h],
                          }
                    }
                    transition={{
                      duration: 1.4 + i * 0.12,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: i * 0.07,
                    }}
                    initial={{ height: h }}
                  />
                ))}
              </div>
              <span className="hidden sm:inline">
                BLK #{block.toLocaleString()}
              </span>
            </div>

            {/* Right: render status + frame */}
            <div className="flex items-center gap-4 font-mono text-[9px] text-white/35 tracking-[0.12em]">
              <span className="hidden lg:inline">◐ MONITORING</span>
              <div className="flex gap-[4px] items-center">
                {[1, 0.6, 0.3].map((op, i) => (
                  <motion.span
                    key={i}
                    className="block rounded-full bg-white"
                    style={{ width: 4, height: 4, opacity: op }}
                    animate={reduce ? undefined : { opacity: [op, op * 0.3, op] }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      delay: i * 0.2,
                    }}
                  />
                ))}
              </div>
              <span className="hidden lg:inline">
                FRAME {frame.toString().padStart(4, "0")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── "∞ RISK.AUTOMATION" rule above status bar ────────────── */}
      <div
        className="absolute left-0 right-0 z-30 pointer-events-none hidden md:flex items-center gap-3 px-8"
        style={{ bottom: 49 }}
        aria-hidden="true"
      >
        <div className="w-8 h-px bg-white/15" />
        <span className="font-mono text-[8px] text-white/20 tracking-[0.2em]">∞</span>
        <div className="flex-1 h-px bg-white/[0.06]" />
        <span className="font-mono text-[8px] text-white/20 tracking-[0.2em] uppercase">
          Risk.Automation
        </span>
        <div className="w-8 h-px bg-white/15" />
      </div>
    </>
  );
}

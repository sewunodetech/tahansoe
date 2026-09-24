"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { LayoutDashboard } from "lucide-react";

export function Navbar() {
  const { isConnected } = useAccount();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16">
      <div className="absolute inset-0 bg-[#080808]/80 backdrop-blur-md border-b border-white/[0.06]" />

      <nav className="relative max-w-[1400px] mx-auto px-6 h-full flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          {/* Shield icon with teal glow */}
          <div className="relative flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background: "radial-gradient(circle, rgba(45,212,191,0.25) 0%, transparent 70%)",
                filter: "blur(6px)",
              }}
              aria-hidden="true"
            />
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true" className="relative">
              <path d="M11 2L3 5.5V10.5C3 14.72 6.42 18.66 11 20C15.58 18.66 19 14.72 19 10.5V5.5L11 2Z" stroke="#2dd4bf" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M8 11L10.5 13.5L14.5 9" stroke="#2dd4bf" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-white text-[14px] font-semibold tracking-[-0.01em]">Tahansoe</span>
        </div>

        {/* Center nav */}
        <ul className="hidden md:flex items-center gap-7 text-[13px] text-white/40">
          <li><a href="#how-it-works" className="hover:text-white transition-colors duration-150">How it works</a></li>
          <li><a href="#features" className="hover:text-white transition-colors duration-150">Features</a></li>
          <li><a href="#risk" className="hover:text-white transition-colors duration-150">Risk disclosure</a></li>
        </ul>

        {/* Right CTAs */}
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Link
              href="/dashboard"
              className="hidden md:flex items-center gap-1.5 h-8 px-3.5 rounded-[6px] bg-white text-[#080808] text-[12px] font-semibold tracking-[-0.01em] hover:bg-white/90 transition-colors"
            >
              <LayoutDashboard className="w-3.5 h-3.5" strokeWidth={2} />
              Dashboard
            </Link>
          ) : (
            <Link
              href="/connect"
              className="hidden md:flex items-center justify-center h-8 px-3.5 rounded-[6px] border border-white/10 text-white/50 text-[12px] font-medium tracking-[-0.01em] hover:text-white/80 hover:border-white/20 transition-colors"
            >
              Connect wallet
            </Link>
          )}

          {/* Mobile hamburger */}
          <button className="md:hidden flex flex-col gap-1.5 p-1" aria-label="Open menu">
            <span className="w-5 h-px bg-white block" />
            <span className="w-5 h-px bg-white block" />
            <span className="w-3 h-px bg-white block" />
          </button>
        </div>
      </nav>
    </header>
  );
}

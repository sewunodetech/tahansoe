"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

const links = [
  { href: "#health-factor", label: "Health Factor" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
  { href: "#risk", label: "Risks" },
];

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 256 256" fill="white" aria-hidden="true">
      <path d="M 256 64 L 256 128 L 192.5 128 L 160 95 L 128 64 L 96 95 L 63.5 128 L 64 128 L 128 192 L 128 256 L 64.5 256 L 32 223 L 0 192 L 0 64 L 64 0 L 192 0 Z M 256 192 L 256 256 L 192.5 256 L 160 223 L 128 192 L 128 128 L 192 128 Z" />
    </svg>
  );
}

/** Fixed frosted-glass navigation with a fullscreen mobile menu. */
export function Navbar() {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const cta = { href: isConnected ? "/dashboard" : "/connect", label: isConnected ? "Dashboard" : "Connect wallet" };

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-5 sm:px-8 py-5">
        <a href="#hero" aria-label="Tahansoe home" className="flex items-center gap-3">
          <Logo />
          <span className="hidden sm:inline font-display text-[22px] leading-none text-white">Tahansoe</span>
        </a>

        <nav
          className="liquid-glass hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center gap-1 rounded-full p-1.5"
          aria-label="Main menu"
        >
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap text-white/70 hover:text-white transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <Link
          href={cta.href}
          className="liquid-glass hidden sm:inline-flex ml-auto mr-3 lg:mr-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium whitespace-nowrap text-white"
        >
          <span className="w-2 h-2 rounded-full bg-green-400" aria-hidden="true" />
          {cta.label}
        </Link>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="liquid-glass lg:hidden flex flex-col items-end justify-center gap-[5px] w-12 h-12 rounded-full"
        >
          <span className="block w-5 h-[1.5px] bg-white mr-[14px]" />
          <span className="block w-3.5 h-[1.5px] bg-white mr-[14px]" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-[55] bg-[#0a0a0a] flex flex-col lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex justify-end px-5 sm:px-8 py-5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="liquid-glass menu-close relative w-12 h-12 rounded-full"
            >
              <span className="absolute left-1/2 top-1/2 w-5 h-[1.5px] bg-white -translate-x-1/2 -translate-y-1/2 rotate-45" />
              <span className="absolute left-1/2 top-1/2 w-5 h-[1.5px] bg-white -translate-x-1/2 -translate-y-1/2 -rotate-45" />
            </button>
          </div>

          <nav className="flex-1 flex flex-col items-center justify-center gap-6" aria-label="Mobile menu">
            {links.map((l, i) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="menu-item text-3xl sm:text-4xl font-medium text-white/90"
                style={{ animationDelay: `${100 + i * 60}ms` }}
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex justify-center pb-12">
            <Link
              href={cta.href}
              onClick={() => setOpen(false)}
              className="liquid-glass menu-item inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium text-white"
              style={{ animationDelay: `${100 + links.length * 60}ms` }}
            >
              <span className="w-2 h-2 rounded-full bg-green-400" aria-hidden="true" />
              {cta.label}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

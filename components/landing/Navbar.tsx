"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { BrandMark } from "@/components/ui/brand-mark";

const links = [
  { href: "#health-factor", label: "Health Factor" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
  { href: "#risk", label: "Risks" },
];

/** Fixed frosted-glass navigation with a fullscreen mobile menu. */
export function Navbar() {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const cta = { href: isConnected ? "/dashboard" : "/connect", label: isConnected ? "Dashboard" : "Connect wallet" };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <header
        className={`fixed top-0 inset-x-0 z-50 flex items-center justify-between px-5 sm:px-8 py-5 transition-[background-color,backdrop-filter,box-shadow] duration-300 ${
          scrolled ? "bg-[#0b1110]/70 backdrop-blur-xl shadow-[0_1px_0_rgba(253,241,225,0.08)]" : ""
        }`}
      >
        <a href="#hero" aria-label="Tahansoe home" className="flex items-center gap-3">
          <BrandMark size={28} />
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

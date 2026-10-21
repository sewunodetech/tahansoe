"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { BrandMark } from "@/components/ui/brand-mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Menu, X, ArrowUpRight } from "lucide-react";

const navLinks = [
  { href: "#layers", label: "Layers" },
  { href: "#agents", label: "Agents" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

export function Navbar() {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-200 border-b ${
          scrolled
            ? "bg-[var(--bg)]/85 backdrop-blur-md border-[var(--border)] shadow-xs"
            : "bg-transparent border-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 outline-none">
            <BrandMark size={28} />
            <span className="font-display font-medium text-lg tracking-tight text-[var(--text-primary)]">
              Tahansoe
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 border border-[var(--border)] rounded-full px-3 py-1 bg-[var(--bg-subtle)]/70 backdrop-blur-sm" aria-label="Main">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="px-3.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-full"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />

            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[var(--brand)] text-white hover:bg-[var(--color-brand-400)] active:bg-[var(--color-brand-midnight)] text-xs font-medium transition-all shadow-xs"
            >
              <span>{isConnected ? "Dashboard" : "Launch app"}</span>
              <ArrowUpRight className="size-3.5 opacity-80" />
            </Link>

            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-label="Toggle navigation menu"
              aria-expanded={open}
              className="md:hidden inline-flex items-center justify-center size-8 rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-[var(--bg)]/95 backdrop-blur-lg md:hidden flex flex-col pt-20 px-6 pb-8"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex flex-col gap-4 mt-6">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="text-lg font-medium text-[var(--text-primary)] py-2 border-b border-[var(--border)]"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="mt-auto pt-6 flex flex-col gap-3">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="w-full flex items-center justify-center gap-2 h-11 rounded-lg bg-[var(--brand)] text-white text-sm font-medium"
            >
              <span>{isConnected ? "Dashboard" : "Launch app"}</span>
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

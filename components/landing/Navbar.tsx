"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { BrandMark } from "@/components/ui/brand-mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Menu, X } from "lucide-react";

const navLinks = [
  { href: "#layers", label: "Layers" },
  { href: "#agents", label: "Agents" },
  { href: "#contract", label: "Contract" },
  { href: "#faq", label: "FAQ" },
];

export function Navbar() {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const cta = isConnected ? "Dashboard" : "Launch app";

  return (
    <>
      <header className="absolute top-0 inset-x-0 z-50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark size={22} />
            <span className="text-[15px] tracking-tight text-[var(--text-primary)]">Tahansoe</span>
          </Link>

          <div className="flex items-center gap-1">
            <nav className="hidden md:flex items-center" aria-label="Main">
              {navLinks.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="px-3.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {l.label}
                </a>
              ))}
            </nav>

            <ThemeToggle className="border-transparent bg-transparent mx-1" />

            <Link
              href="/dashboard"
              className="hidden sm:inline-flex items-center h-9 px-4 rounded-full bg-[var(--brand)] text-white hover:bg-[var(--color-brand-400)] text-[13px] transition-colors"
            >
              {cta}
            </Link>

            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-label="Toggle navigation menu"
              aria-expanded={open}
              className="md:hidden inline-flex items-center justify-center size-9 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-[var(--bg)] md:hidden flex flex-col pt-20 px-6 pb-8"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex flex-col">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="text-lg text-[var(--text-primary)] py-3 border-b border-[var(--border)]"
              >
                {l.label}
              </a>
            ))}
          </div>
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="mt-auto flex items-center justify-center h-11 rounded-full bg-[var(--brand)] text-white text-sm"
          >
            {cta}
          </Link>
        </div>
      )}
    </>
  );
}

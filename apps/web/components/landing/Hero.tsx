"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

const HeroScene = dynamic(() => import("./HeroScene").then((m) => m.HeroScene), {
  ssr: false,
  loading: () => null,
});

const SLIDES = [
  { light: "Keeping your", bold: ["loan safe from", "liquidation"], tail: "while you sleep" },
  { light: "Layer 1", bold: ["repays from", "your wallet"], tail: "before it's too late" },
  { light: "Layer 2", bold: ["taps your other", "DeFi positions"], tail: "when the wallet runs dry" },
  { light: "Layer 3", bold: ["flash-deleverages", "your position"], tail: "as the last line of defence" },
];

export function Hero() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SLIDES.length), 5000);
    return () => clearInterval(t);
  }, []);
  const s = SLIDES[i];

  return (
    <section className="relative">
      <div>
        <div className="absolute inset-0">
          <div className="absolute inset-0 iridescent-glow md:[background-position:30%_0]" />
          <HeroScene />
        </div>
        <div className="relative grid md:grid-cols-[1fr_1.15fr] min-h-[100svh] pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          {/* Left: copy */}
          <div className="relative z-10 flex flex-col justify-between px-6 sm:px-12 md:pl-[max(4rem,calc((100vw-1200px)/2))] md:pr-12 pt-[46svh] md:pt-28 pb-10 md:pb-12">
            <div className="hidden md:block" />
            <div>
              <h1
                key={i}
                className="font-display uppercase text-[34px] sm:text-[44px] leading-[1.08] tracking-[-0.01em] text-[var(--text-primary)] animate-in fade-in slide-in-from-bottom-2 duration-500"
              >
                <span className="font-light block">{s.light}</span>
                {s.bold.map((b) => (
                  <span key={b} className="font-semibold block">{b}</span>
                ))}
                <span className="font-light block">{s.tail}</span>
              </h1>

              <div className="mt-8 flex items-center gap-3" role="tablist" aria-label="Hero slides">
                {SLIDES.map((_, n) => (
                  <button
                    key={n}
                    role="tab"
                    aria-selected={n === i}
                    aria-label={`Slide ${n + 1}`}
                    onClick={() => setI(n)}
                    className={`size-3 rounded-full border border-[var(--text-primary)] transition-colors ${
                      n === i ? "bg-[var(--text-primary)]" : "bg-transparent"
                    }`}
                  />
                ))}
              </div>

              <div className="mt-10 flex flex-wrap gap-3">
                <Link href="/connect" className="btn-iridescent">Launch app</Link>
                <a href="#layers" className="btn-ghost-soft">See the 3 layers</a>
              </div>
            </div>

            <div className="mt-10 md:mt-16">
              <p className="eyebrow">Testnet · Aave V3 on Arbitrum</p>
              <p className="mt-2 text-[17px] font-medium text-[var(--text-primary)]">
                Liquidation protection you approve yourself
              </p>
            </div>
          </div>

          {/* Spacer column: the 3D canvas sits behind the whole hero */}
          <div className="hidden md:block" />
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef } from "react";

/* eslint-disable @next/next/no-img-element -- remote layered hero imagery */

const BG_IMAGE =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260713_140344_79e1296a-86d7-43fd-9b5f-63ffe560f291.png&w=1280&q=85";
const FRONT_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260713_162101_0d7498c5-29bb-47bf-a99f-2773c0a880a9.mp4";
const OVERLAY_IMAGE =
  "https://soft-zoom-63098134.figma.site/_assets/v11/3f10f1876e118f72a396e05a6c2d099569478272.png";

const RADIUS = 260;
// The mask is drawn at reduced resolution; the soft gradient scales up without visible loss.
const MASK_SCALE = 0.25;

/**
 * Fullscreen hero: grid parallax, product imagery, and a cursor-following
 * spotlight that reveals the looping video in the lower 60% of the viewport.
 */
export function SpotlightHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const gridRef = useRef<SVGSVGElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // React doesn't render the `muted` attribute server-side, which blocks autoplay.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {});
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    const grid = gridRef.current;
    const reveal = revealRef.current;
    if (!section || !grid || !reveal) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let targetX = -9999, targetY = -9999, smoothX = -9999, smoothY = -9999;
    let gridTX = 0, gridTY = 0, gridX = 0, gridY = 0;
    let raf = 0;
    let running = false;

    const resize = () => {
      const r = section.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * MASK_SCALE));
      canvas.height = Math.max(1, Math.round(r.height * MASK_SCALE));
    };

    const drawMask = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const x = smoothX * MASK_SCALE, y = smoothY * MASK_SCALE, r = RADIUS * MASK_SCALE;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.4, "rgba(255,255,255,1)");
      g.addColorStop(0.6, "rgba(255,255,255,0.75)");
      g.addColorStop(0.75, "rgba(255,255,255,0.4)");
      g.addColorStop(0.88, "rgba(255,255,255,0.12)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const url = `url(${canvas.toDataURL()})`;
      reveal.style.maskImage = url;
      reveal.style.webkitMaskImage = url;
    };

    const tick = () => {
      smoothX += (targetX - smoothX) * 0.1;
      smoothY += (targetY - smoothY) * 0.1;
      gridX += (gridTX - gridX) * 0.06;
      gridY += (gridTY - gridY) * 0.06;
      grid.style.transform = `translate3d(${gridX}px, ${gridY}px, 0)`;
      drawMask();

      const settled =
        Math.abs(targetX - smoothX) < 0.3 && Math.abs(targetY - smoothY) < 0.3 &&
        Math.abs(gridTX - gridX) < 0.05 && Math.abs(gridTY - gridY) < 0.05;
      if (settled) { running = false; return; }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const r = section.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (smoothX < -9000) { smoothX = x; smoothY = y; } // no sweep-in on first move
      targetX = x; targetY = y;
      gridTX = ((x - r.width / 2) / r.width) * 16;
      gridTY = ((y - r.height / 2) / r.height) * 16;
      start();
    };

    resize();
    drawMask();
    window.addEventListener("resize", resize);
    section.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      section.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="hero"
      className="relative h-[100svh] min-h-[560px] w-full overflow-hidden bg-[#0a0a0a]"
      aria-label="Tahansoe"
    >
      {/* Layer 1 — parallax grid */}
      <div className="absolute -inset-6 z-0 opacity-10 pointer-events-none" aria-hidden="true">
        <svg ref={gridRef} className="w-full h-full will-change-transform">
          <defs>
            <pattern id="hero-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#64748b" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hero-grid)" />
        </svg>
      </div>

      {/* Layer 2 — background image */}
      <div
        className="absolute inset-0 z-10 bg-center bg-cover bg-no-repeat"
        style={{ backgroundImage: `url("${BG_IMAGE}")` }}
        aria-hidden="true"
      />

      {/* Layer 3 — heading */}
      <h1
        className="absolute inset-x-0 top-20 sm:top-28 md:top-32 z-20 text-center uppercase text-white leading-[0.9] text-[4.5rem] min-[480px]:text-[5.5rem] sm:text-[10rem] md:text-[13rem] lg:text-[16rem] font-display font-normal"
      >
        Tahansoe
      </h1>

      {/* Layer 4 — atmospheric overlay */}
      <img
        src={OVERLAY_IMAGE}
        alt=""
        className="absolute inset-0 z-[25] w-full h-full object-cover pointer-events-none"
      />

      {/* Layer 5 — spotlight reveal (video, lower 60% only) */}
      <div
        ref={revealRef}
        className="absolute inset-0 z-30 pointer-events-none"
        style={{ maskSize: "100% 100%", WebkitMaskSize: "100% 100%", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" }}
        aria-hidden="true"
      >
        <video
          ref={videoRef}
          src={FRONT_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ clipPath: "inset(40% 0 0 0)" }}
        />
      </div>

      {/* Tagline */}
      <div className="absolute inset-x-0 bottom-10 z-40 px-6 flex flex-col items-center text-center gap-5 pointer-events-none">
        <p className="max-w-[520px] text-[15px] sm:text-[17px] leading-[1.45] text-white/80">
          Liquidation protection for your DeFi loans. Tahansoe watches your Health Factor every block
          and acts before liquidators can.
        </p>
        <a
          href="#health-factor"
          className="liquid-glass pointer-events-auto rounded-full px-6 py-3 text-sm font-medium text-white"
        >
          See how it works
        </a>
      </div>
    </section>
  );
}

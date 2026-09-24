"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseAlpha: number;
  pulseOffset: number;
}

const MAX_DIST = 140;
const COUNT_BASE = 65;

export function ParticleMesh() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ctx is non-null — guarded above
    const c = ctx as CanvasRenderingContext2D;
    let particles: Particle[] = [];
    let W = 0, H = 0;
    let mX = -9999, mY = -9999;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      c.scale(dpr, dpr);
      particles = spawn(W, H);
    }

    function spawn(w: number, h: number): Particle[] {
      const n = Math.round(COUNT_BASE * (w / 1440));
      return Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        radius: Math.random() * 1.4 + 0.5,
        baseAlpha: Math.random() * 0.45 + 0.1,
        pulseOffset: Math.random() * Math.PI * 2,
      }));
    }

    function tick(t: number) {
      c.clearRect(0, 0, W, H);

      for (const p of particles) {
        p.x = (p.x + p.vx + W) % W;
        p.y = (p.y + p.vy + H) % H;
      }

      // Connections
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > MAX_DIST) continue;
          const proximity = 1 - d / MAX_DIST;
          // Mouse boost for nearby connections
          const mda = Math.hypot(a.x - mX, a.y - mY);
          const boost = mda < 180 ? (1 - mda / 180) * 0.5 : 0;
          c.beginPath();
          c.strokeStyle = `rgba(253,241,225,${(proximity * 0.15 + boost * proximity).toFixed(3)})`;
          c.lineWidth = 0.5;
          c.moveTo(a.x, a.y);
          c.lineTo(b.x, b.y);
          c.stroke();
        }
      }

      // Nodes
      for (const p of particles) {
        const pulse = Math.sin(t * 0.0007 + p.pulseOffset) * 0.25 + 0.75;
        const md = Math.hypot(p.x - mX, p.y - mY);
        const boost = md < 140 ? (1 - md / 140) * 0.7 : 0;
        const alpha = Math.min(1, p.baseAlpha * pulse + boost);
        c.beginPath();
        c.arc(p.x, p.y, p.radius + boost * 1.5, 0, Math.PI * 2);
        c.fillStyle = `rgba(253,241,225,${alpha.toFixed(3)})`;
        c.fill();
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mX = e.clientX - r.left;
      mY = e.clientY - r.top;
    };
    const onLeave = () => { mX = -9999; mY = -9999; };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    if (!reduceMotion) rafRef.current = requestAnimationFrame(tick);
    else tick(0);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [reduceMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full"
      style={{ opacity: 0.3, pointerEvents: "none" }}
    />
  );
}

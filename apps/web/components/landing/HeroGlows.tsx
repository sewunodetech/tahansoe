"use client";

import { motion, useReducedMotion } from "motion/react";

export function HeroGlows() {
  const reduce = useReducedMotion();

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">

      {/* Large top-center white bloom — the "sun" */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 800,
          height: 500,
          top: -180,
          left: "50%",
          x: "-50%",
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(253,241,225,0.08) 0%, rgba(253,241,225,0.02) 50%, transparent 75%)",
          filter: "blur(60px)",
        }}
        animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Blue accent — left */}
      <motion.div
        className="absolute"
        style={{
          width: 600,
          height: 600,
          borderRadius: "50%",
          top: "15%",
          left: "-10%",
          background:
            "radial-gradient(ellipse, rgba(56,189,248,0.09) 0%, transparent 65%)",
          filter: "blur(80px)",
        }}
        animate={reduce ? undefined : { y: [0, 40, 0], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Green accent — right, signals "SAFE" */}
      <motion.div
        className="absolute"
        style={{
          width: 700,
          height: 700,
          borderRadius: "50%",
          top: "5%",
          right: "-12%",
          background:
            "radial-gradient(ellipse, rgba(34,197,94,0.07) 0%, transparent 60%)",
          filter: "blur(90px)",
        }}
        animate={reduce ? undefined : { y: [0, -30, 0], opacity: [0.5, 0.85, 0.5] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />

      {/* Red danger pulse — bottom, represents liquidation risk */}
      <motion.div
        className="absolute"
        style={{
          width: 500,
          height: 300,
          borderRadius: "50%",
          bottom: "0%",
          left: "5%",
          background:
            "radial-gradient(ellipse, rgba(239,68,68,0.07) 0%, transparent 70%)",
          filter: "blur(70px)",
        }}
        animate={reduce ? undefined : { opacity: [0.3, 0.75, 0.3], scale: [1, 1.15, 1] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
      />

      {/* Horizontal scan line — sweeps top to bottom */}
      {!reduce && (
        <motion.div
          className="absolute left-0 right-0"
          style={{
            height: "1px",
            background:
              "linear-gradient(90deg, transparent 0%, rgba(253,241,225,0.04) 20%, rgba(253,241,225,0.15) 50%, rgba(253,241,225,0.04) 80%, transparent 100%)",
          }}
          initial={{ top: 0, opacity: 0 }}
          animate={{ top: "100%", opacity: [0, 1, 1, 0] }}
          transition={{
            duration: 4,
            repeat: Infinity,
            repeatDelay: 6,
            ease: "linear",
            times: [0, 0.02, 0.98, 1],
          }}
        />
      )}
    </div>
  );
}

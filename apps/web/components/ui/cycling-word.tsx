"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

interface CyclingWordProps {
  words: string[];
  interval?: number;
  className?: string;
}

/**
 * Displays one word at a time, flipping through the list on a 3D Y-axis
 * rotation (perspective flip). Respects prefers-reduced-motion.
 */
export function CyclingWord({
  words,
  interval = 2000,
  className = "",
}: CyclingWordProps) {
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % words.length);
    }, interval);
    return () => clearInterval(t);
  }, [words.length, interval, reduce]);

  const word = words[index];

  if (reduce) {
    return <span className={className}>{word}</span>;
  }

  return (
    // Perspective wrapper — gives the flip depth
    <span
      className="inline-block relative"
      style={{ perspective: "600px", perspectiveOrigin: "50% 50%" }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={word}
          className={`inline-block ${className}`}
          style={{ transformOrigin: "50% 0%", display: "inline-block" }}
          initial={{ rotateX: -90, opacity: 0, y: "-20%" }}
          animate={{ rotateX: 0, opacity: 1, y: "0%" }}
          exit={{ rotateX: 90, opacity: 0, y: "20%" }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 22,
            mass: 0.8,
          }}
        >
          {word}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

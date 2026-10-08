"use client";

import { useState, useCallback } from "react";

type LinkStatus = "idle" | "loading" | "ready" | "error";

export function useTelegramLink() {
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [status, setStatus] = useState<LinkStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const generateCode = useCallback(async () => {
    try {
      setStatus("loading");
      setError(null);

      const res = await fetch("/api/telegram/link-code", {
        method: "POST",
      });

      if (!res.ok) {
        const { error: errMsg } = await res.json();
        throw new Error(errMsg ?? "Failed to generate link code");
      }

      const { code } = await res.json();
      setLinkCode(code);
      setStatus("ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate link code";
      setError(msg);
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setLinkCode(null);
    setStatus("idle");
    setError(null);
  }, []);

  return { linkCode, status, error, generateCode, reset };
}
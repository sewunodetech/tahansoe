"use client";

import { useState, useCallback } from "react";
import { useAccount, useSignMessage, useChainId } from "wagmi";
import { SiweMessage } from "siwe";

type AuthStatus = "idle" | "loading-nonce" | "awaiting-signature" | "verifying" | "authenticated" | "error";

export function useAuth() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const [status, setStatus] = useState<AuthStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (!address || !isConnected) {
      setError("Wallet not connected");
      setStatus("error");
      return;
    }

    try {
      setStatus("loading-nonce");
      setError(null);

      const nonceRes = await fetch("/api/auth/nonce");
      if (!nonceRes.ok) {
        throw new Error("Failed to fetch nonce");
      }
      const { nonce } = await nonceRes.json();

      const domain = window.location.hostname;
      const origin = window.location.origin;
      const message = new SiweMessage({
        domain,
        address,
        statement: "Sign in to Tahansoe to enable liquidation risk protection.",
        uri: origin,
        version: "1",
        chainId,
        nonce,
      });

      setStatus("awaiting-signature");

      const signature = await signMessageAsync({
        message: message.prepareMessage(),
      });

      setStatus("verifying");

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });

      if (!verifyRes.ok) {
        const { error: errMsg } = await verifyRes.json();
        throw new Error(errMsg ?? "Verification failed");
      }

      setStatus("authenticated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      setError(msg);
      setStatus("error");
    }
  }, [address, isConnected, chainId, signMessageAsync]);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return { signIn, status, error, reset };
}
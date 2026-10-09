"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";

export function useAuthGuard() {
  const { isConnected, isConnecting, address } = useAccount();
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [sessionValid, setSessionValid] = useState(false);

  useEffect(() => {
    if (isConnecting) return;

    if (!isConnected) {
      router.replace("/connect");
      return;
    }

    let cancelled = false;

    fetch("/api/auth/me")
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setSessionValid(true);
        } else {
          router.replace("/connect");
        }
      })
      .catch(() => {
        if (!cancelled) router.replace("/connect");
      })
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });

    return () => { cancelled = true; };
  }, [isConnected, isConnecting, router]);

  return { isConnected: isConnected && sessionValid, address, sessionChecked };
}
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { SIM_CONNECTOR_ID } from "@/lib/sim/connector";

/**
 * Keeps dashboard pages behind a session: SIWE for a real wallet, or a simulation session
 * (/api/sim/session) for the burner wallet. The sim session never grants real-user data access;
 * those routes check the SIWE `userId` on the server.
 */
export function useAuthGuard() {
  const { isConnected, isConnecting, address, connector } = useAccount();
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [sessionValid, setSessionValid] = useState(false);
  const isSimulation = connector?.id === SIM_CONNECTOR_ID;

  useEffect(() => {
    if (isConnecting) return;

    if (!isConnected) {
      router.replace("/connect");
      return;
    }

    let cancelled = false;

    fetch(isSimulation ? "/api/sim/session" : "/api/auth/me")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          router.replace(isSimulation ? "/connect?sim=ended" : "/connect");
          return;
        }
        if (isSimulation) {
          const sim = (await res.json()) as { address?: string };
          if (sim.address?.toLowerCase() !== address?.toLowerCase()) {
            router.replace("/connect?sim=ended");
            return;
          }
        }
        setSessionValid(true);
      })
      .catch(() => {
        if (!cancelled) router.replace("/connect");
      })
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });

    return () => { cancelled = true; };
  }, [isConnected, isConnecting, isSimulation, address, router]);

  return { isConnected: isConnected && sessionValid, address, sessionChecked, isSimulation };
}

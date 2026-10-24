"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { Wallet, AlertCircle, Loader2, ArrowLeft, FlaskConical } from "lucide-react";
import { BrandMark } from "@/components/ui/brand-mark";
import { SIM_CONNECTOR_ID } from "@/lib/sim/connector";
import { getOrCreateBurner } from "@/lib/sim/burner";
import { setSimRpcPath } from "@/lib/sim/rpc";
import { SimApiError, startSimSession } from "@/lib/sim/hooks";
import type { SimHealth } from "@/lib/sim/types";

const WALLETS = [
  {
    id: "metaMask",
    name: "MetaMask",
    description: "Browser extension wallet",
    icon: (
      <svg viewBox="0 0 35 33" className="w-6 h-6" fill="none">
        <path d="M32.958 1L19.48 10.808l2.442-5.79L32.958 1z" fill="#E17726" stroke="#E17726" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2.042 1l13.36 9.895-2.323-5.877L2.042 1z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M28.229 23.533l-3.588 5.494 7.676 2.114 2.202-7.48-6.29-.128z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M.481 23.661l2.186 7.48 7.66-2.114-3.572-5.494-6.274.128z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9.961 14.564l-2.136 3.23 7.608.343-.256-8.193-5.216 4.62z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M25.039 14.564l-5.286-4.71-.175 8.283 7.593-.343-2.132-3.23z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10.327 29.027l4.573-2.209-3.95-3.086-.623 5.295z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M20.1 26.818l4.573 2.209-.639-5.295-3.934 3.086z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "injected",
    name: "Browser Wallet",
    description: "Coinbase, Rabby, or any injected wallet",
    icon: <Wallet className="w-6 h-6 text-[var(--text-secondary)]" strokeWidth={1.5} />,
  },
  {
    id: "walletConnect",
    name: "WalletConnect",
    description: "Scan with any mobile wallet",
    icon: (
      <svg viewBox="0 0 300 185" className="w-6 h-6">
        <path d="M61.44 36.37c48.85-47.85 128.05-47.85 176.9 0l5.88 5.76a6.04 6.04 0 010 8.67l-20.1 19.69a3.18 3.18 0 01-4.43 0l-8.1-7.93c-34.07-33.38-89.33-33.38-123.4 0l-8.67 8.49a3.18 3.18 0 01-4.43 0L54.99 50.86a6.04 6.04 0 010-8.67l6.45-5.82zm218.36 40.67l17.89 17.52a6.04 6.04 0 010 8.67l-80.67 79.01a6.35 6.35 0 01-8.87 0L149.7 124.8a1.59 1.59 0 00-2.22 0l-58.4 57.44a6.35 6.35 0 01-8.87 0L.54 103.23a6.04 6.04 0 010-8.67l17.89-17.52a6.35 6.35 0 018.87 0l58.4 57.44c.61.6 1.6.6 2.22 0l58.4-57.44a6.35 6.35 0 018.87 0l58.4 57.44c.61.6 1.6.6 2.22 0l58.4-57.44a6.35 6.35 0 018.86 0z" fill="#3B99FC"/>
      </svg>
    ),
  },
];

/** Where to land after connecting: the dashboard page the visitor was sent here from, if any. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/dashboard") ? next : "/dashboard";
}

export default function ConnectPage() {
  const router = useRouter();
  const { isConnected, address, connector: activeConnector } = useAccount();
  const chainId = useChainId();
  const { connect, connectAsync, connectors, isPending, error: connectError, variables } = useConnect();
  const { disconnect, disconnectAsync } = useDisconnect();
  const { signIn, status: authStatus, error: authError, reset: resetAuth } = useAuth();

  const [step, setStep] = useState<"connect" | "sign">("connect");
  const [simHealth, setSimHealth] = useState<SimHealth | null>(null);
  const [simStarting, setSimStarting] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simEnded, setSimEnded] = useState(false);
  const isSimConnected = activeConnector?.id === SIM_CONNECTOR_ID;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sim/health")
      .then((res) => (res.ok ? res.json() : { ok: false }))
      .then((h: SimHealth) => { if (!cancelled) setSimHealth(h); })
      .catch(() => { if (!cancelled) setSimHealth({ ok: false }); });
    return () => { cancelled = true; };
  }, []);

  // The burner wallet never signs in with SIWE: resume its simulation, or drop it when it ended.
  useEffect(() => {
    if (!isConnected || !isSimConnected || simStarting) return;
    if (new URLSearchParams(window.location.search).get("sim") === "ended") {
      setSimRpcPath(null);
      disconnect();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect the redirect reason once
      setSimEnded(true);
      return;
    }
    router.replace(nextPath());
  }, [isConnected, isSimConnected, simStarting, disconnect, router]);

  useEffect(() => {
    if (isConnected && !isSimConnected && step === "connect") {
      // Check if session already valid before prompting sign-in
      fetch("/api/auth/me")
        .then((res) => {
          if (res.ok) {
            router.replace(nextPath());
          } else {
            setStep("sign");
          }
        })
        .catch(() => setStep("sign"));
    }
  }, [isConnected, isSimConnected, step, router]);

  useEffect(() => {
    if (isConnected && !isSimConnected && step === "sign") {
      signIn();
    }
  }, [isConnected, isSimConnected, step, signIn]);

  useEffect(() => {
    if (authStatus === "authenticated") {
      router.replace(nextPath());
    }
  }, [authStatus, router]);

  const getConnectorByWalletId = (id: string) => {
    if (id === "metaMask") return connectors.find((c) => c.name === "MetaMask" || (c.id === "injected" && c.name?.toLowerCase().includes("metamask")));
    if (id === "walletConnect") return connectors.find((c) => c.id === "walletConnect");
    return connectors.find((c) => c.id === "injected");
  };

  const handleConnect = (walletId: string) => {
    const connector = getConnectorByWalletId(walletId);
    if (!connector) return;
    connect({ connector });
  };

  const simAvailable = simHealth?.ok === true;

  /** Burner key in this browser + a Live fork session, then into the dashboard. */
  const handleStartSimulation = async () => {
    const simConnector = connectors.find((c) => c.id === SIM_CONNECTOR_ID);
    if (!simConnector) return;
    setSimStarting(true);
    setSimError(null);
    try {
      if (isConnected) await disconnectAsync();
      const burner = getOrCreateBurner();
      await startSimSession({ address: burner.address, mode: "live" });
      await connectAsync({ connector: simConnector });
      router.replace(nextPath());
    } catch (err) {
      setSimError(
        err instanceof SimApiError && err.status === 409
          ? "All simulation slots are busy. Try again in a minute."
          : err instanceof Error ? err.message : "Could not start the simulation."
      );
      setSimStarting(false);
    }
  };

  const handleBack = () => {
    disconnect();
    resetAuth();
    setStep("connect");
  };

  const short = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(253,241,225,0.05) 0%, transparent 100%)",
        }}
      />

      <div className="relative z-10 w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-10">
          <BrandMark size={44} className="mb-5" />
          <h1 className="font-display text-[32px] font-normal text-[var(--text-primary)] leading-tight mb-1">
            {step === "connect" ? "Connect to Tahansoe" : "Sign in"}
          </h1>
          <p className="text-[13px] text-[var(--text-tertiary)] text-center max-w-[280px]">
            {step === "connect"
              ? "Connect your wallet to monitor and protect your DeFi positions."
              : "Sign the message to verify wallet ownership."}
          </p>
        </div>

        {step === "connect" && (
          <div className="flex flex-col gap-2">
            {WALLETS.map((wallet) => {
              const connector = getConnectorByWalletId(wallet.id);
              const pendingConnector = isPending
                ? connectors.find((c) => c === variables?.connector)
                : undefined;
              const isLoading = isPending && pendingConnector?.id === connector?.id;

              return (
                <button
                  key={wallet.id}
                  onClick={() => handleConnect(wallet.id)}
                  disabled={isPending || !connector}
                  className="w-full flex items-center gap-4 px-4 py-3.5 rounded-[16px] glass-surface hover:border-[var(--border-strong)] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed text-left group"
                >
                  <div className="w-10 h-10 rounded-[8px] bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center shrink-0">
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 text-[var(--text-secondary)] animate-spin" strokeWidth={1.5} />
                    ) : (
                      wallet.icon
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)] group-hover:text-[var(--text-primary)] transition-colors">
                      {wallet.name}
                    </p>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                      {wallet.description}
                    </p>
                  </div>
                  {!connector && (
                    <span className="text-[10px] font-mono text-[var(--text-disabled)] shrink-0">
                      Not detected
                    </span>
                  )}
                </button>
              );
            })}

            <div className="flex items-center gap-3 my-3" aria-hidden>
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-disabled)]">or</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
            </div>

            <button
              type="button"
              onClick={handleStartSimulation}
              disabled={!simAvailable || simStarting || isPending}
              className="w-full flex items-center gap-4 px-4 py-3.5 rounded-[16px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)] hover:bg-[var(--bg-hover)] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-left"
            >
              <div className="w-10 h-10 rounded-[8px] bg-[var(--warning-bg)] border border-[var(--warning-border)] flex items-center justify-center shrink-0">
                {simStarting || simHealth === null ? (
                  <Loader2 className="w-5 h-5 text-[var(--warning)] animate-spin" strokeWidth={1.5} />
                ) : (
                  <FlaskConical className="w-5 h-5 text-[var(--warning)]" strokeWidth={1.5} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[var(--text-primary)]">
                  Try a simulation first — no wallet needed
                </p>
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  {simStarting
                    ? "Creating your simulation wallet…"
                    : "Fake funds on a fork of Arbitrum One. Watch the Guardian protect a position."}
                </p>
              </div>
            </button>

            {simHealth && !simHealth.ok && (
              <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed px-1">
                The simulation network is offline right now. Try the{" "}
                <a href="/simulation" className="text-[var(--brand)] underline underline-offset-2">
                  in-browser demo
                </a>{" "}
                instead, or connect a wallet and switch the dashboard to Demo mode.
              </p>
            )}

            {simEnded && (
              <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed px-1">
                Your simulation session ended. Start a new one any time.
              </p>
            )}

            {simError && (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-[8px] bg-red-500/8 border border-red-500/15">
                <AlertCircle className="w-4 h-4 text-red-400/70 shrink-0 mt-0.5" strokeWidth={1.5} />
                <p className="text-[12px] text-red-400/70 leading-relaxed">{simError}</p>
              </div>
            )}

            {connectError && (
              <div className="mt-4 flex items-start gap-2.5 px-4 py-3 rounded-[8px] bg-red-500/8 border border-red-500/15">
                <AlertCircle className="w-4 h-4 text-red-400/70 shrink-0 mt-0.5" strokeWidth={1.5} />
                <p className="text-[12px] text-red-400/70 leading-relaxed">
                  {connectError.message?.includes("User rejected")
                    ? "Connection rejected."
                    : (connectError.message ?? "Failed to connect.")}
                </p>
              </div>
            )}
          </div>
        )}

        {step === "sign" && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-full p-4 rounded-[16px] glass-surface">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-[11px] text-[var(--text-secondary)]">{short}</span>
                <span className="text-[10px] text-[var(--text-disabled)]">{chainId ? `Chain ${chainId}` : ""}</span>
              </div>

              {authStatus === "loading-nonce" && (
                <div className="flex items-center gap-2.5 text-[var(--text-tertiary)]">
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                  <span className="text-[12px]">Fetching sign-in request...</span>
                </div>
              )}

              {authStatus === "awaiting-signature" && (
                <div className="flex items-center gap-2.5 text-[var(--text-secondary)]">
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                  <span className="text-[12px]">Waiting for signature...</span>
                </div>
              )}

              {authStatus === "verifying" && (
                <div className="flex items-center gap-2.5 text-[var(--text-tertiary)]">
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                  <span className="text-[12px]">Verifying signature...</span>
                </div>
              )}

              {authStatus === "error" && (
                <div>
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-[7px] bg-red-500/8 border border-red-500/15 mb-3">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400/70 shrink-0 mt-0.5" strokeWidth={1.5} />
                    <p className="text-[11px] text-red-400/70 leading-relaxed">{authError}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleBack}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-[6px] border border-[var(--border)] text-[var(--text-tertiary)] text-[12px] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      <ArrowLeft className="w-3 h-3" strokeWidth={1.5} />
                      Back
                    </button>
                    <button
                      onClick={signIn}
                      className="h-8 px-4 rounded-full btn-iridescent !h-8 !text-[12px] font-semibold transition-colors"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-[var(--text-disabled)]">
          By connecting you agree to our{" "}
          <span className="underline underline-offset-2 cursor-pointer hover:text-[var(--text-tertiary)] transition-colors">
            terms
          </span>
          . Tahansoe never has custody of your funds.
        </p>
      </div>
    </div>
  );
}
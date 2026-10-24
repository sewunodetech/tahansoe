import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { FaucetAsset, SimSessionInfo } from "@/lib/sim/types";

/**
 * Simulation Mode session (spec m1-simulation-mode §3.5). Kept apart from the SIWE fields: it
 * never sets `userId`, so routes that serve real user data stay closed to it.
 */
export interface SimCookieData extends SimSessionInfo {
  /** Row id in sim_sessions. */
  dbId: string;
  /** Amount topped up so far, per asset, against the per-session faucet limits. */
  faucet?: Partial<Record<FaucetAsset, number>>;
  /** Layers already written to sim_sessions.layers_used. */
  layersRecorded?: number[];
}

export interface SessionData {
  userId: string;
  walletAddress: string;
  sim?: SimCookieData;
  /** sim_sessions row to mark converted once the user signs in with a real wallet. */
  simConvertedFrom?: string;
}

export async function getSession() {
  const session = await getIronSession<SessionData>(await cookies(), {
    password: process.env.SESSION_SECRET!,
    cookieName: "tahansoe-session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  });
  return session;
}

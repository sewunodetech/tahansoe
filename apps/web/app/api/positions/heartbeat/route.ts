/**
 * GET /api/positions/heartbeat
 *
 * Returns sentinel check time and position check times for the authenticated user
 * (spec m1-positions-holdings-guardian-view §3.8).
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, positions, isDbConfigured, type Db } from "@tahansoe/db";
import { getSession, type SessionData } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/sim/rate-limit";

export interface HeartbeatPosition {
  protocol: string;
  chainId: number;
  marketId: string | null;
  lastCheckedAt: string | null;
}

export interface PositionsHeartbeatResponse {
  checkedAt: string | null;
  positions: HeartbeatPosition[];
}

export interface RawPositionRow {
  protocol: string;
  chainId: number;
  marketId: string | null;
  lastCheckedAt: Date | string | null;
}

export function formatPositionsHeartbeat(rows: RawPositionRow[]): PositionsHeartbeatResponse {
  const formatted: HeartbeatPosition[] = rows.map((r) => {
    let iso: string | null = null;
    if (r.lastCheckedAt instanceof Date) {
      iso = r.lastCheckedAt.toISOString();
    } else if (r.lastCheckedAt) {
      iso = new Date(r.lastCheckedAt).toISOString();
    }
    return {
      protocol: r.protocol,
      chainId: r.chainId,
      marketId: r.marketId,
      lastCheckedAt: iso,
    };
  });

  const checkedAt = formatted[0]?.lastCheckedAt ?? null;
  return {
    checkedAt,
    positions: formatted,
  };
}

export async function handlePositionsHeartbeatRoute(
  req: NextRequest,
  deps: {
    getSession?: () => Promise<Partial<SessionData> | null | undefined>;
    db?: Db;
    isDbConfigured?: () => boolean;
  } = {}
): Promise<NextResponse> {
  if (!rateLimit(`positions-heartbeat:${clientIp(req.headers)}`, 120)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const sessionGetter = deps.getSession ?? getSession;
  let session: Partial<SessionData> | null | undefined;
  try {
    session = await sessionGetter();
  } catch (err) {
    console.error("[heartbeat] Failed to get session:", err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Requires a SIWE session with session.userId.
  // No session, or simulation-only session (session.sim set and no userId) -> 401.
  if (!session || !session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkDbConfig = deps.isDbConfigured ?? isDbConfigured;
  if (!checkDbConfig()) {
    console.warn("[heartbeat] Database is not configured, returning empty positions heartbeat");
    return NextResponse.json({ checkedAt: null, positions: [] }, { status: 200 });
  }

  const dbClient = deps.db ?? db;
  try {
    const rows = await dbClient
      .select({
        protocol: positions.protocol,
        chainId: positions.chainId,
        marketId: positions.marketId,
        lastCheckedAt: positions.lastCheckedAt,
      })
      .from(positions)
      .where(eq(positions.userId, session.userId))
      .orderBy(desc(positions.lastCheckedAt));

    const data = formatPositionsHeartbeat(rows);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[heartbeat] Error querying positions heartbeat:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handlePositionsHeartbeatRoute(req);
}

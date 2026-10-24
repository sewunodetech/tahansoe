/**
 * GET /api/positions/heartbeat
 *
 * When the Sentinel last checked the signed-in user's positions (spec m1-positions-holdings-guardian-view §3.8).
 */

import type { NextRequest } from "next/server";
import { handlePositionsHeartbeatRoute } from "@/lib/positions/heartbeat.server";

export async function GET(req: NextRequest) {
  return handlePositionsHeartbeatRoute(req);
}

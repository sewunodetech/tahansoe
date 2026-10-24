import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { Db } from "@tahansoe/db";
import type { SessionData } from "@/lib/session";
import {
  handlePositionsHeartbeatRoute,
  formatPositionsHeartbeat,
  type RawPositionRow,
} from "./heartbeat.server";

function makeReq(ip = "127.0.0.1"): NextRequest {
  return new NextRequest("http://localhost:3000/api/positions/heartbeat", {
    method: "GET",
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

test("formatPositionsHeartbeat - computes most recent checkedAt and formats rows to ISO", () => {
  const d1 = new Date("2026-10-24T12:00:00Z");
  const d2 = new Date("2026-10-24T11:30:00Z");
  const rows: RawPositionRow[] = [
    {
      protocol: "AAVE_V3",
      chainId: 42161,
      marketId: null,
      lastCheckedAt: d1,
    },
    {
      protocol: "MORPHO_BLUE",
      chainId: 42161,
      marketId: "0xmarket1",
      lastCheckedAt: d2,
    },
  ];

  const res = formatPositionsHeartbeat(rows);
  assert.equal(res.checkedAt, "2026-10-24T12:00:00.000Z");
  assert.equal(res.positions.length, 2);
  assert.equal(res.positions[0].protocol, "AAVE_V3");
  assert.equal(res.positions[0].lastCheckedAt, "2026-10-24T12:00:00.000Z");
  assert.equal(res.positions[1].protocol, "MORPHO_BLUE");
  assert.equal(res.positions[1].lastCheckedAt, "2026-10-24T11:30:00.000Z");
});

test("formatPositionsHeartbeat - handles empty rows", () => {
  const res = formatPositionsHeartbeat([]);
  assert.equal(res.checkedAt, null);
  assert.deepEqual(res.positions, []);
});

test("GET /api/positions/heartbeat - returns 401 when session is missing", async () => {
  const req = makeReq("192.168.1.1");
  const res = await handlePositionsHeartbeatRoute(req, {
    getSession: async () => null,
  });

  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, "Unauthorized");
});

test("GET /api/positions/heartbeat - returns 401 when session has no userId (empty session)", async () => {
  const req = makeReq("192.168.1.2");
  const res = await handlePositionsHeartbeatRoute(req, {
    getSession: async () => ({}) as Partial<SessionData>,
  });

  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, "Unauthorized");
});

test("GET /api/positions/heartbeat - returns 401 for simulation-only session (sim set, no userId)", async () => {
  const req = makeReq("192.168.1.3");
  const res = await handlePositionsHeartbeatRoute(req, {
    getSession: async () => ({
      sim: {
        sessionId: "sim-123",
        address: "0x1111111111111111111111111111111111111111",
        forkId: "fork-123",
        mode: "live" as const,
        expiresAt: null,
        rpcPath: "/rpc/fork-123",
        contracts: {
          guardian: "0x1111111111111111111111111111111111111111",
          simPriceFeed: "0x2222222222222222222222222222222222222222",
          pool: "0x3333333333333333333333333333333333333333",
          weth: "0x4444444444444444444444444444444444444444",
          usdc: "0x5555555555555555555555555555555555555555",
        },
        dbId: "db-sim-1",
      },
    }),
  });

  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, "Unauthorized");
});

test("GET /api/positions/heartbeat - returns 200 with empty data when DB is not configured", async () => {
  const req = makeReq("192.168.1.4");
  const res = await handlePositionsHeartbeatRoute(req, {
    getSession: async () => ({ userId: "user-123", walletAddress: "0x123" }),
    isDbConfigured: () => false,
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.checkedAt, null);
  assert.deepEqual(json.positions, []);
});

test("GET /api/positions/heartbeat - returns user positions when DB is configured and user is authenticated", async () => {
  const req = makeReq("192.168.1.5");
  const now = new Date("2026-10-24T15:00:00Z");

  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [
            {
              protocol: "AAVE_V3",
              chainId: 421614,
              marketId: null,
              lastCheckedAt: now,
            },
          ],
        }),
      }),
    }),
  } as unknown as Db;

  const res = await handlePositionsHeartbeatRoute(req, {
    getSession: async () => ({ userId: "user-abc", walletAddress: "0xabc" }),
    isDbConfigured: () => true,
    db: mockDb,
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.checkedAt, "2026-10-24T15:00:00.000Z");
  assert.deepEqual(json.positions, [
    {
      protocol: "AAVE_V3",
      chainId: 421614,
      marketId: null,
      lastCheckedAt: "2026-10-24T15:00:00.000Z",
    },
  ]);
});

/**
 * Unit test offline untuk settle-job (ADR 0005, spec §3.5).
 *
 * Menguji:
 *  - Idempotensi: tidak menduplikasi baris di risk_settlements
 *  - Penanganan insufficient_data: tidak memberi label palsu saat data tidak cukup
 *  - Pelabelan akurat untuk report yang jatuh tempo
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@tahansoe/db";
import { runSettlementJob } from "../../src/reflection/settle-job.ts";
import type { Outcome } from "../../src/reflection/outcomes.ts";

describe("runSettlementJob", () => {
  const t0 = new Date("2026-10-08T00:00:00Z");
  const tHorizon = new Date("2026-10-09T00:00:00Z");
  const tNow = new Date("2026-10-09T01:00:00Z");

  it("melakukan settlement akurat dan idempotent (tidak menduplikasi)", async () => {
    const existingReports = [
      {
        id: "rep-1",
        chainId: 42161,
        report: { assets: ["WETH"], proposedRegime: "STRESSED" },
        promptVersion: "2026.10.1",
        horizonEndsAt: tHorizon,
        createdAt: t0,
      },
    ];

    const insertedSettlements: any[] = [];

    // Mock DB yang melacak baris yang telah disettle
    const mockDb = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: async () => {
              // Simulasikan leftJoin: jika rep-1 sudah ada di insertedSettlements, return kosong
              const pending = existingReports.filter(
                (r) => !insertedSettlements.some((s) => s.researchReportId === r.id),
              );
              return pending;
            },
          }),
        }),
      }),
      insert: () => ({
        values: async (data: any) => {
          insertedSettlements.push(data);
          return [data];
        },
      }),
    } as unknown as Db;

    // Mock computeOutcome yang menghasilkan crash (bad outcome T1)
    const mockOutcomeFn = async (): Promise<Outcome> => ({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tHorizon,
      maxDrawdownPct: 0.15,
      triggeredPaths: ["T1"],
      hadBadOutcome: true,
      worstOutcomeAt: new Date(t0.getTime() + 6 * 3600 * 1000),
      insufficientData: false,
    });

    // Run pertama
    const res1 = await runSettlementJob({
      now: tNow,
      db: mockDb,
      computeOutcomeFn: mockOutcomeFn,
    });

    assert.equal(res1.totalEvaluated, 1);
    assert.equal(res1.settled.length, 1);
    assert.equal(res1.settled[0]?.label, "TRUE_POSITIVE");
    assert.equal(res1.settled[0]?.leadTimeMinutes, 360);
    assert.equal(insertedSettlements.length, 1);

    // Run kedua (Idempotensi)
    const res2 = await runSettlementJob({
      now: tNow,
      db: mockDb,
      computeOutcomeFn: mockOutcomeFn,
    });

    assert.equal(res2.totalEvaluated, 0);
    assert.equal(res2.settled.length, 0);
    // Tidak ada baris baru yang di-insert
    assert.equal(insertedSettlements.length, 1);
  });

  it("melewati laporan dengan data tidak cukup tanpa menyimpan label palsu", async () => {
    const existingReports = [
      {
        id: "rep-insufficient",
        chainId: 42161,
        report: { assets: ["WETH"], proposedRegime: "STRESSED" },
        promptVersion: "2026.10.1",
        horizonEndsAt: tHorizon,
        createdAt: t0,
      },
    ];

    const insertedSettlements: any[] = [];

    const mockDb = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: async () => existingReports,
          }),
        }),
      }),
      insert: () => ({
        values: async (data: any) => {
          insertedSettlements.push(data);
          return [data];
        },
      }),
    } as unknown as Db;

    const mockInsufficientOutcomeFn = async (): Promise<Outcome> => ({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tHorizon,
      maxDrawdownPct: 0,
      triggeredPaths: [],
      hadBadOutcome: false,
      insufficientData: true,
      insufficientReason: "Hanya ada 0 sampel harga",
    });

    const res = await runSettlementJob({
      now: tNow,
      db: mockDb,
      computeOutcomeFn: mockInsufficientOutcomeFn,
    });

    assert.equal(res.totalEvaluated, 1);
    assert.equal(res.settled.length, 0);
    assert.equal(res.insufficientData.length, 1);
    assert.equal(res.insufficientData[0]?.reportId, "rep-insufficient");
    // Tidak ada baris yang di-insert ke risk_settlements (mencegah label palsu)
    assert.equal(insertedSettlements.length, 0);
  });
});

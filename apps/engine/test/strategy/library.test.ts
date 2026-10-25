/**
 * Test unit strategy library & seed version loader (spec §3.4).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  SEED_STRATEGY_VERSION,
  loadActiveStrategyVersion,
  createStrategyLibrary,
} from "../../src/strategy/library.ts";

test("SEED_STRATEGY_VERSION: berisi playbook MANUAL berbasis PRD §6", () => {
  assert.equal(SEED_STRATEGY_VERSION.version, "pp-2026.10.0");
  assert.equal(SEED_STRATEGY_VERSION.status, "ACTIVE");
  assert.ok(SEED_STRATEGY_VERSION.playbooks.length >= 5);

  for (const pb of SEED_STRATEGY_VERSION.playbooks) {
    assert.equal(pb.source, "MANUAL");
    assert.ok(pb.targetHf > 1.2);
    assert.ok(pb.id.startsWith("pb-"));
  }

  // Harus mencakup playbook untuk CRISIS, STRESSED, dan ELEVATED
  const regimes = SEED_STRATEGY_VERSION.playbooks.map((p) => p.when.regimeAtLeast);
  assert.ok(regimes.includes("CRISIS"));
  assert.ok(regimes.includes("STRESSED"));
  assert.ok(regimes.includes("ELEVATED"));
});

test("loadActiveStrategyVersion: fallback ke SEED_STRATEGY_VERSION saat DB tidak ada atau kosong", async () => {
  // Tanpa parameter DB (atau DB kosong) -> kembalikan seed version
  const version = await loadActiveStrategyVersion();
  assert.equal(version.version, "pp-2026.10.0");
  assert.equal(version.status, "ACTIVE");
});

test("loadActiveStrategyVersion: membaca baris ACTIVE dari DB jika tersedia", async () => {
  const fakeDb: any = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [
              {
                version: "pp-2026.11.0",
                playbooks: [
                  {
                    id: "custom-pb-1",
                    description: "custom test playbook",
                    when: { regimeAtLeast: "STRESSED", hfBelow: 1.3 },
                    action: "REPAY_WALLET",
                    targetHf: 1.6,
                    source: "MANUAL",
                  },
                ],
                status: "ACTIVE",
              },
            ],
          }),
        }),
      }),
    }),
  };

  const version = await loadActiveStrategyVersion(fakeDb);
  assert.equal(version.version, "pp-2026.11.0");
  assert.equal(version.playbooks.length, 1);
  assert.equal(version.playbooks[0]!.id, "custom-pb-1");
});

test("createStrategyLibrary: mengembalikan instance StrategyLibrary", async () => {
  const lib = createStrategyLibrary();
  assert.equal(typeof lib.getActiveVersion, "function");
  const version = await lib.getActiveVersion();
  assert.equal(version.version, "pp-2026.10.0");
});

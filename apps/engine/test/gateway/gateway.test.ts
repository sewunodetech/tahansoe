/**
 * Integration test startGateway() dan gatewayStatus() (spec m3-channel-gateway-telegram §7).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startGateway, gatewayStatus } from "../../src/gateway/index.ts";
import { writeSettings, emptySettings } from "../../src/settings/settings.ts";

test("gateway: gatewayStatus mendeteksi konfigurasi berdasarkan env dan settings", () => {
  // Tanpa token
  const statusEmpty = gatewayStatus({});
  assert.equal(statusEmpty.configured, false);
  assert.deepEqual(statusEmpty.channels, []);

  // Dengan token aktif
  const statusActive = gatewayStatus({ TELEGRAM_BOT_TOKEN: "fake_token_123" });
  assert.equal(statusActive.configured, true);
  assert.deepEqual(statusActive.channels, ["telegram"]);

  // Dengan token tapi settings disabled
  const statusDisabled = gatewayStatus(
    { TELEGRAM_BOT_TOKEN: "fake_token_123" },
    {
      ...emptySettings(),
      gateway: {
        channels: { telegram: { enabled: false, allowedChats: [] } },
        alertPollSec: 60,
        qaPerDay: 20,
        dailySummary: false,
      },
    },
  );
  assert.equal(statusDisabled.configured, false);
  assert.deepEqual(statusDisabled.channels, []);
});

test("gateway: startGateway memulai lifecycle dan mengembalikan stop() serta pairing api", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const fakeFetch: typeof fetch = async (input) => {
    const s = String(input);
    if (s.includes("getUpdates")) {
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const logs: string[] = [];
  const instance = await startGateway({
    env: { TELEGRAM_BOT_TOKEN: "fake_test_token_gw" },
    settingsPath: settingsFile,
    statePath: stateFile,
    fetchFn: fakeFetch,
    logger: (msg: string) => logs.push(msg),
    pollIntervalSec: 9999,
  });

  assert.ok(instance.pairing, "Harus menyediakan instance pairing");
  const { code } = instance.pairing.createPairingCode("telegram");
  assert.ok(code.length >= 8);
  assert.equal(instance.pairing.pairingStatus(code).status, "pending");

  // Hentikan gateway
  await instance.stop();

  assert.ok(logs.some((l) => l.includes("Adapter started")));
  assert.ok(logs.some((l) => l.includes("Gateway stopped")));

  // ASSERT: token tidak bocor di logs
  for (const l of logs) {
    assert.ok(!l.includes("fake_test_token_gw"), `Token leaked in log: ${l}`);
  }

  await rm(tmp, { recursive: true, force: true });
});

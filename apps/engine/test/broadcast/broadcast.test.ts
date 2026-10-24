/**
 * Test Offline BroadcastWorker (spec m3-research-broadcast §3 T4).
 *
 * Menguji:
 *  1. Jadwal digest (pencocokan waktu & zona waktu Asia/Jakarta)
 *  2. Dedupe (6 jam tidak kirim ulang, kecuali severity naik)
 *  3. Hysteresis (regime turun ditahan >= 1 jam)
 *  4. 403 / blocked menonaktifkan akun & kegagalan per-chat tidak mematikan batch
 *  5. 429 retry (backoff retry_after)
 *  6. Escape HTML & footer wajib
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BroadcastWorker, getLocalParts } from "../../src/broadcast/worker.ts";
import { TelegramMessageQueue } from "../../src/telegram/queue.ts";
import { escapeHtml, digestView, footer, regimeUpAlert } from "../../src/telegram/views.ts";
import { TelegramApiError, type TelegramSender } from "../../src/telegram/types.ts";
import type { RiskAssessment, Signal } from "@tahansoe/domain";

describe("BroadcastWorker & Telegram Outbound", () => {
  test("1. Jadwal digest & konversi zona waktu", () => {
    // 2026-10-23T01:00:00Z = 08:00 Asia/Jakarta (+7)
    const dateAt0800Jakarta = new Date("2026-10-23T01:00:00Z");
    const parts = getLocalParts(dateAt0800Jakarta, "Asia/Jakarta");
    assert.equal(parts.dateStr, "2026-10-23");
    assert.equal(parts.timeStr, "08:00");

    // 2026-10-23T13:00:00Z = 20:00 Asia/Jakarta
    const dateAt2000Jakarta = new Date("2026-10-23T13:00:00Z");
    const parts20 = getLocalParts(dateAt2000Jakarta, "Asia/Jakarta");
    assert.equal(parts20.timeStr, "20:00");

    // Waktu lain, mis. 08:05 Jakarta (01:05Z)
    const dateAt0805Jakarta = new Date("2026-10-23T01:05:00Z");
    const parts0805 = getLocalParts(dateAt0805Jakarta, "Asia/Jakarta");
    assert.equal(parts0805.timeStr, "08:05");
  });

  test("2. Dedupe: 6 jam tidak kirim ulang, kecuali severity naik", async () => {
    const recordedBroadcasts: Record<string, { severity: number; createdAt: Date }> = {};

    const sentMessages: string[] = [];
    const fakeSender: TelegramSender = {
      send: async (_chatId, html) => {
        sentMessages.push(html);
      },
    };

    let simulatedTime = new Date("2026-10-23T10:00:00Z");

    const worker = new BroadcastWorker({
      env: {},
      sender: fakeSender,
      now: () => simulatedTime,
      loadRecipients: async () => [
        { telegramUserId: 111n, telegramUsername: "user1", userId: "u1" },
      ],
      loadAssessments: async () => [],
      loadActiveSignals: async () => [
        {
          id: "sig-1",
          chainId: 42161,
          module: "ORACLE",
          paths: ["T8"],
          assets: ["ETH"],
          direction: "DOWN",
          severity: 0.6,
          confidence: 0.8,
          horizonHours: 4,
          observedAt: simulatedTime,
          expiresAt: new Date(simulatedTime.getTime() + 4 * 3600 * 1000),
          evidence: [{ source: "oracle", title: "Oracle lag detected" }],
        },
      ],
      loadLatestReport: async () => null,
      isDeduped: async (key, severity, now) => {
        const prev = recordedBroadcasts[key];
        if (!prev) return false;
        const age = now.getTime() - prev.createdAt.getTime();
        if (age >= 6 * 3600 * 1000) return false;
        if (severity > prev.severity) return false;
        return true;
      },
      recordBroadcast: async ({ dedupeKey }) => {
        recordedBroadcasts[dedupeKey] = {
          severity: 0.6,
          createdAt: simulatedTime,
        };
      },
    });

    // Run 1: sinyal pertama kali terdeteksi -> harus terkirim
    const sent1 = await worker.pollOnce();
    assert.equal(sent1, 1);
    assert.equal(sentMessages.length, 1);

    // Run 2: polling 10 menit kemudian dengan severity yang sama -> harus di-dedupe (0 terkirim)
    simulatedTime = new Date("2026-10-23T10:10:00Z");
    const sent2 = await worker.pollOnce();
    assert.equal(sent2, 0);
    assert.equal(sentMessages.length, 1);

    // Run 3: severity naik ke 0.9 (masih dalam 6 jam) -> harus diizinkan terkirim ulang
    (worker as any).loaders.loadActiveSignals = async () => [
      {
        id: "sig-1",
        chainId: 42161,
        module: "ORACLE",
        paths: ["T8"],
        assets: ["ETH"],
        direction: "DOWN",
        severity: 0.9,
        confidence: 0.9,
        horizonHours: 4,
        observedAt: simulatedTime,
        expiresAt: new Date(simulatedTime.getTime() + 4 * 3600 * 1000),
        evidence: [{ source: "oracle", title: "Oracle lag escalated" }],
      },
    ];

    const sent3 = await worker.pollOnce();
    assert.equal(sent3, 1);
    assert.equal(sentMessages.length, 2);

    // Run 4: setelah 7 jam berlalu -> jendela dedupe kadaluarsa, boleh kirim lagi
    simulatedTime = new Date("2026-10-23T18:00:00Z");
    const sent4 = await worker.pollOnce();
    assert.equal(sent4, 1);
    assert.equal(sentMessages.length, 3);
  });

  test("3. Hysteresis: regime turun ditahan minimal 1 jam", async () => {
    let simulatedTime = new Date("2026-10-23T10:00:00Z");
    const sentAlerts: string[] = [];

    const fakeSender: TelegramSender = {
      send: async (_chatId, html) => {
        sentAlerts.push(html);
      },
    };

    let currentRegime: "CALM" | "ELEVATED" | "STRESSED" = "ELEVATED";

    const worker = new BroadcastWorker({
      env: {},
      sender: fakeSender,
      now: () => simulatedTime,
      loadRecipients: async () => [{ telegramUserId: 123n }],
      loadAssessments: async () => [
        {
          asset: "USDC",
          chainId: 42161,
          regime: currentRegime,
          riskScore: 60,
          drawdownEstimate: { h4: 0.05, h24: 0.1 },
          recommendedTriggerHF: 1.4,
          recommendedTargetHF: 1.7,
          drivers: [],
          explanation: "Testing regime hysteresis",
          modelVersion: "1.0",
          validUntil: new Date(simulatedTime.getTime() + 3600 * 1000),
          createdAt: simulatedTime,
        },
      ],
      loadActiveSignals: async () => [],
      loadLatestReport: async () => null,
      isDeduped: async () => false,
      recordBroadcast: async () => {},
    });

    // Tick 1: Awal pengamatan USDC ELEVATED (initial observe, belum ada pembanding)
    await worker.pollOnce();
    assert.equal(sentAlerts.length, 0);

    // Tick 2: USDC naik ke STRESSED -> harus segera kirim alert
    simulatedTime = new Date(simulatedTime.getTime() + 60 * 1000);
    currentRegime = "STRESSED";
    await worker.pollOnce();
    assert.equal(sentAlerts.length, 1);
    assert.match(sentAlerts[0]!, /ELEVATED → STRESSED/);

    // Tick 3: 30 menit kemudian, kondisi membaik menjadi ELEVATED (turun)
    // Tapi karena baru bertahan 30m (< 1 jam), alert regime turun DITAHAN
    simulatedTime = new Date(simulatedTime.getTime() + 30 * 60 * 1000);
    currentRegime = "ELEVATED";
    await worker.pollOnce();
    assert.equal(sentAlerts.length, 1); // tetap 1, belum dikirim

    // Tick 4: 65 menit kemudian (> 1 jam bertahan di STRESSED)
    simulatedTime = new Date(simulatedTime.getTime() + 35 * 60 * 1000);
    await worker.pollOnce();
    assert.equal(sentAlerts.length, 2); // sekarang terkirim alert regime turun
    assert.match(sentAlerts[1]!, /kembali ke ELEVATED/);
  });

  test("4. 403 menonaktifkan akun & tidak mematikan batch", async () => {
    const deactivatedUsers: (bigint | string)[] = [];
    const deliveredTo: (bigint | string | number)[] = [];

    const fakeSender: TelegramSender = {
      send: async (chatId, _html) => {
        if (chatId === 222n) {
          // Chat 222 memblokir bot (403 Forbidden)
          throw new TelegramApiError(
            "Forbidden: bot was blocked by the user",
            403,
            403,
            "bot was blocked by the user",
            true,
          );
        }
        deliveredTo.push(chatId);
      },
    };

    const worker = new BroadcastWorker({
      env: {},
      sender: fakeSender,
      loadRecipients: async () => [
        { telegramUserId: 111n, telegramUsername: "ok_user_1" },
        { telegramUserId: 222n, telegramUsername: "blocked_user" },
        { telegramUserId: 333n, telegramUsername: "ok_user_2" },
      ],
      deactivateRecipient: async (id) => {
        deactivatedUsers.push(id);
      },
      recordBroadcast: async () => {},
    });

    const res = await worker.sendDigest();

    // Akun 222 dinonaktifkan
    assert.deepEqual(deactivatedUsers, [222n]);
    // Batch tetap selesai: 111 dan 333 berhasil dikirim
    assert.deepEqual(deliveredTo, [111n, 333n]);
    assert.equal(res.sentCount, 2);
    assert.equal(res.failedCount, 1);
  });

  test("5. 429 retry: patuhi parameter retry_after", async () => {
    let callCount = 0;
    const fetchCalls: number[] = [];

    const mockFetch = async () => {
      callCount++;
      fetchCalls.push(Date.now());
      if (callCount === 1) {
        // Panggilan pertama melempar 429 dengan retry_after: 0.1 detik
        return {
          status: 429,
          ok: false,
          json: async () => ({
            ok: false,
            error_code: 429,
            description: "Too Many Requests",
            parameters: { retry_after: 0.1 },
          }),
        } as any;
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 12345 },
        }),
      } as any;
    };

    const queue = new TelegramMessageQueue({
      token: "dummy:token",
      fetchFn: mockFetch,
      minGlobalIntervalMs: 10,
      minChatIntervalMs: 10,
      maxRetries: 2,
    });

    await queue.enqueue("999", "Halo broadcast");
    queue.stop();

    assert.equal(callCount, 2);
    assert.equal(fetchCalls.length, 2);
    // Panggilan kedua dilakukan setelah retry_after
    assert.ok(fetchCalls[1]! - fetchCalls[0]! >= 50);
  });

  test("6. Escape HTML & footer wajib 'informational · not investment advice'", () => {
    // Karakter berbahaya HTML di-escape
    const dangerous = 'Malicious <script>alert("xss")</script> & <b>bold</b>';
    const escaped = escapeHtml(dangerous);
    assert.equal(
      escaped,
      'Malicious &lt;script&gt;alert("xss")&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;',
    );

    // Footer wajib
    const ftId = footer("id");
    assert.match(ftId, /Informasi risiko · bukan saran investasi/);
    const ftEn = footer("en");
    assert.match(ftEn, /informational · not investment advice/);

    // Digest HTML ter-escape dan memuat footer
    const digest = digestView({
      dateStr: "2026-10-23",
      assessments: [
        {
          asset: "ETH <safe>",
          chainId: 42161,
          regime: "CALM",
          riskScore: 20,
          drawdownEstimate: { h4: 0.02, h24: 0.05 },
          recommendedTriggerHF: 1.25,
          recommendedTargetHF: 1.6,
          drivers: [],
          explanation: "Normal conditions",
          modelVersion: "1.0",
          validUntil: new Date(),
          createdAt: new Date(),
        },
      ],
      signals: [],
      lang: "en",
    });

    assert.match(digest, /informational · not investment advice/);
    assert.doesNotMatch(digest, /<safe>/);
    assert.match(digest, /&lt;safe&gt;/);
    assert.match(digest, /normal conditions/i);

    // Alert HTML ter-escape
    const alertHtml = regimeUpAlert("ETH", "CALM", "ELEVATED", "Notice <unsafe> alert & check", new Date(), "en");
    assert.doesNotMatch(alertHtml, /<unsafe>/);
    assert.match(alertHtml, /&lt;unsafe&gt;/);
    assert.match(alertHtml, /&amp;/);
  });

  test("7. openAdvisoryLock melempar error: JANGAN kirim & coba lagi di siklus berikut", async () => {
    let attempts = 0;
    const sentMessages: string[] = [];
    const fakeSender: TelegramSender = {
      send: async (_chatId, html) => {
        sentMessages.push(html);
      },
    };

    const worker = new BroadcastWorker({
      env: {},
      sender: fakeSender,
      databaseUrl: "postgresql://fake:5432/db",
      openLock: async () => {
        attempts++;
        throw new Error("Neon connection failed transiently");
      },
      loadRecipients: async () => [{ telegramUserId: 111n, userId: "u1" }],
      loadAssessments: async () => [],
      loadActiveSignals: async () => [
        {
          id: "sig-crit",
          chainId: 42161,
          module: "ONCHAIN",
          paths: ["T10"],
          assets: ["ETH"],
          direction: "DOWN",
          severity: 0.9,
          confidence: 1.0,
          horizonHours: 2,
          observedAt: new Date(),
          expiresAt: new Date(Date.now() + 7200000),
          evidence: [],
        },
      ],
      loadLatestReport: async () => null,
      isDeduped: async () => false,
      recordBroadcast: async () => {},
    });

    // pollOnce saat lock melempar error: JANGAN kirim (returns 0, sentMessages empty)
    const sent = await worker.pollOnce();
    assert.equal(sent, 0);
    assert.equal(sentMessages.length, 0);
    assert.equal(attempts, 1);
  });

  test("8. Instance pasif mencoba ulang mengambil lock di setiap pollOnce dan mengambil alih saat pemegang lock mati", async () => {
    let lockHolderAlive = true;
    let lockAcquireAttempts = 0;
    const sentMessages: string[] = [];
    const fakeSender: TelegramSender = {
      send: async (_chatId, html) => {
        sentMessages.push(html);
      },
    };

    const worker = new BroadcastWorker({
      env: {},
      sender: fakeSender,
      databaseUrl: "postgresql://fake:5432/db",
      openLock: async () => {
        lockAcquireAttempts++;
        if (lockHolderAlive) {
          return {
            client: {} as any,
            acquired: false,
            key: 42161006,
            release: async () => {},
            isLost: () => false,
          };
        }
        return {
          client: {} as any,
          acquired: true,
          key: 42161006,
          release: async () => {},
          isLost: () => false,
        };
      },
      loadRecipients: async () => [{ telegramUserId: 111n, userId: "u1" }],
      loadAssessments: async () => [],
      loadActiveSignals: async () => [
        {
          id: "sig-crit-2",
          chainId: 42161,
          module: "ONCHAIN",
          paths: ["T4"],
          assets: ["USDC"],
          direction: "DOWN",
          severity: 0.8,
          confidence: 0.95,
          horizonHours: 2,
          observedAt: new Date(),
          expiresAt: new Date(Date.now() + 7200000),
          evidence: [],
        },
      ],
      loadLatestReport: async () => null,
      isDeduped: async () => false,
      recordBroadcast: async () => {},
    });

    // Siklus 1: Pemegang lock lama masih hidup -> instance pasif tidak mengirim
    const sent1 = await worker.pollOnce();
    assert.equal(sent1, 0);
    assert.equal(sentMessages.length, 0);
    assert.equal(lockAcquireAttempts, 1);

    // Siklus 2: Pemegang lock mati (lockHolderAlive = false)
    lockHolderAlive = false;
    const sent2 = await worker.pollOnce();
    assert.equal(sent2, 1);
    assert.equal(sentMessages.length, 1);
    assert.equal(lockAcquireAttempts, 2);
  });

  test("9. Sinyal RESEARCH ber-path T7/T10 tidak memicu alert kritis; ONCHAIN T7 tetap", async () => {
    const now = new Date("2026-10-24T06:00:00Z");
    const sentMessages: string[] = [];
    const base = {
      chainId: 42161,
      assets: ["ETH", "USDC"],
      direction: "DOWN" as const,
      confidence: 0.6,
      horizonHours: 72,
      observedAt: now,
      expiresAt: new Date(now.getTime() + 72 * 3600 * 1000),
    };
    const research = (id: string): Signal => ({
      ...base,
      id,
      module: "RESEARCH",
      paths: ["T11", "T7", "T10", "T4"],
      severity: 0.55,
      evidence: [],
    });
    const worker = new BroadcastWorker({
      env: {},
      sender: { send: async (_chatId, html) => void sentMessages.push(html) },
      now: () => now,
      loadRecipients: async () => [{ telegramUserId: 111n, userId: "u1" }],
      loadAssessments: async () => [],
      loadActiveSignals: async () => [
        research("r-1"),
        research("r-2"),
        {
          ...base,
          id: "o-1",
          module: "ONCHAIN",
          paths: ["T11"],
          severity: 0.4,
          dedupeKey: "ONCHAIN:T11:kink:USDC",
          evidence: [{ source: "aave_rates", title: "Reserve USDC utilization at 92.0% past optimal kink of 90.0% (borrow APR 4.98%)" }],
        },
        {
          ...base,
          id: "o-2",
          module: "ONCHAIN",
          paths: ["T11", "T7"],
          severity: 0.9,
          dedupeKey: "ONCHAIN:T11:kink:WETH",
          evidence: [{ source: "aave_rates", title: "Reserve WETH utilization at 98.5% past optimal kink of 90.0%" }],
        },
      ],
      loadLatestReport: async () => null,
      isDeduped: async () => false,
      recordBroadcast: async () => {},
    });

    const sent = await worker.pollOnce();
    assert.equal(sent, 1, "hanya ONCHAIN T7 yang dikirim");
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0]!, /liquidity constrained/);
  });

  test("10. Setelah restart, alert yang sudah terkirim < 6 jam tidak dikirim ulang", async () => {
    const sentAt = new Date("2026-10-24T05:00:00Z");
    const now = new Date("2026-10-24T06:00:00Z");
    const fakeDb = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ createdAt: sentAt }] }) }),
      }),
    };
    // Instance baru (memori severity kosong), baris broadcasts dari instance lama 1 jam lalu.
    const worker = new BroadcastWorker({ env: {}, db: fakeDb, now: () => now });
    assert.equal(await worker.isDeduped("alert:signal:ONCHAIN:T11:kink:WETH", 0.9, now), true);
    // Severity naik setelah itu tetap boleh kirim ulang.
    assert.equal(await worker.isDeduped("alert:signal:ONCHAIN:T11:kink:WETH", 1.0, now), false);
    // Lewat 6 jam: boleh kirim ulang.
    const later = new Date("2026-10-24T11:30:00Z");
    assert.equal(await worker.isDeduped("alert:signal:ONCHAIN:T11:kink:FRAX", 0.5, later), false);
  });
});

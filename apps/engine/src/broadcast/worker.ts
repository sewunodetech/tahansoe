/**
 * BroadcastWorker — Pengiriman terjadwal dan alert proaktif (spec m3-research-broadcast §3 T4).
 *
 * Logika:
 *  1. Digest terjadwal pada BROADCAST_DIGEST_TIMES (default "08:00,20:00") di BROADCAST_TZ
 *     (default Asia/Jakarta) menggunakan laporan riset terbaru + assessment fusion.
 *  2. Alert proaktif (dievaluasi berkala tiap 60s & langsung saat research worker selesai):
 *     - Perubahan regime naik per aset (segera)
 *     - Perubahan regime turun per aset setelah bertahan >= 1 jam (hysteresis)
 *     - Sinyal deterministik kritis: T10 (sequencer), T4 (depeg), T7 (pool util >= 98%), T8 (oracle severity >= 0.6)
 *  3. Dedupe & log menggunakan tabel `broadcasts` (dedupe_key unik, jendela dedupe 6 jam kecuali severity naik).
 *  4. Single-instance lock menggunakan Postgres advisory lock 42161006.
 *  5. Rate limit <= 25 msg/s, penanganan 429 retry_after, 403/"chat not found" -> telegram_accounts.is_active=false.
 *  6. Kill switch BROADCAST_ENABLED ("false" = nonaktif), BROADCAST_LANG (default "id").
 *  7. Format HTML ter-escape dengan footer wajib "informational · not investment advice".
 */

import type { Signal, RiskAssessment, Regime } from "@tahansoe/domain";
import { getDb, broadcasts, riskAssessments, signals as signalsTable, researchReports } from "@tahansoe/db";
import { eq, desc, and, gt } from "drizzle-orm";
import { openAdvisoryLock, type AdvisoryLock } from "../worker/lock.ts";
import { rowToSignal, dedupeSignals } from "../signals/dedupe.ts";
import {
  type TelegramSender,
  type FetchedReportLike,
  type Lang,
  TelegramApiError,
  createTelegramSender,
  digestView,
  regimeUpAlert,
  regimeDownAlert,
  signalAlert,
} from "../telegram/index.ts";
import {
  type Recipient,
  getActiveRecipients,
  deactivateRecipient,
} from "./recipients.ts";
import {
  BROADCAST_WORKER_ADVISORY_LOCK_KEY,
  DEFAULT_BROADCAST_DIGEST_TIMES,
  DEFAULT_BROADCAST_TZ,
  DEFAULT_BROADCAST_LANG,
  DEFAULT_BROADCAST_POLL_SEC,
  HYSTERESIS_DOWN_HOLD_MS,
  DEFAULT_DEDUPE_HOURS,
  type BroadcastWorkerOptions,
} from "./types.ts";

const REGIME_LEVELS: Record<Regime, number> = {
  CALM: 0,
  ELEVATED: 1,
  STRESSED: 2,
  CRISIS: 3,
};

export interface AssetRegimeRecord {
  regime: Regime;
  since: number;
  lastObserved: number;
}

/**
 * Dapatkan waktu lokal dalam format YYYY-MM-DD dan HH:mm untuk zona waktu tertentu.
 */
export function getLocalParts(
  date: Date,
  timeZone: string,
): { dateStr: string; timeStr: string } {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    // Formatter en-CA menghasilkan "YYYY-MM-DD, HH:mm" atau "YYYY-MM-DD HH:mm"
    const formatted = formatter.format(date);
    const [datePart, timePart] = formatted.split(/[,\s]+/);
    const dateStr = datePart?.trim() ?? date.toISOString().slice(0, 10);
    const timeStr = (timePart ?? "00:00").trim().slice(0, 5);
    return { dateStr, timeStr };
  } catch {
    const iso = date.toISOString();
    return { dateStr: iso.slice(0, 10), timeStr: iso.slice(11, 16) };
  }
}

export class BroadcastWorker {
  private sender?: TelegramSender;
  private readonly db?: any;
  private readonly databaseUrl?: string;
  private readonly logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  private readonly env: NodeJS.ProcessEnv;
  private readonly getNow: () => Date;
  private readonly pollIntervalSec: number;
  private readonly advisoryLockKey: number;
  private readonly digestTimes: string[];
  private readonly timeZone: string;
  private readonly lang: Lang;
  private readonly isEnabled: boolean;
  private readonly loaders: BroadcastWorkerOptions;
  private readonly openLock: (databaseUrl: string, key: number, options?: any) => Promise<AdvisoryLock>;

  private lock?: AdvisoryLock;
  private timer?: NodeJS.Timeout;
  private running = false;
  private assetRegimes: Record<string, AssetRegimeRecord> = {};
  private alertSeverities: Map<string, number> = new Map();

  constructor(options: BroadcastWorkerOptions = {}) {
    this.loaders = options;
    this.env = options.env ?? process.env;
    this.db = options.db;
    this.databaseUrl = options.databaseUrl ?? this.env.DATABASE_URL;
    this.getNow = options.now ?? (() => new Date());
    this.pollIntervalSec = options.pollIntervalSec ?? DEFAULT_BROADCAST_POLL_SEC;
    this.advisoryLockKey = options.advisoryLockKey ?? BROADCAST_WORKER_ADVISORY_LOCK_KEY;

    this.logger = {
      info: options.logger?.info ?? ((m) => console.log(`[broadcast] ${m}`)),
      warn: options.logger?.warn ?? ((m) => console.warn(`[broadcast] ${m}`)),
      error: options.logger?.error ?? ((m) => console.error(`[broadcast] ${m}`)),
    };

    const rawTimes = this.env.BROADCAST_DIGEST_TIMES || DEFAULT_BROADCAST_DIGEST_TIMES;
    this.digestTimes = rawTimes.split(",").map((t) => t.trim()).filter(Boolean);
    this.timeZone = this.env.BROADCAST_TZ || DEFAULT_BROADCAST_TZ;
    this.lang = (this.env.BROADCAST_LANG as Lang) || DEFAULT_BROADCAST_LANG;
    this.isEnabled = this.env.BROADCAST_ENABLED !== "false";
    this.openLock = (options as any).openLock ?? openAdvisoryLock;

    if (options.sender) {
      this.sender = options.sender;
    } else if (this.env.TELEGRAM_BOT_TOKEN) {
      this.sender = createTelegramSender({
        token: this.env.TELEGRAM_BOT_TOKEN,
        logger: (msg) => this.logger.info(msg),
      });
    }
  }

  public setSender(sender: TelegramSender): void {
    this.sender = sender;
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (!this.isEnabled) {
      this.logger.info("Broadcaster dinonaktifkan (BROADCAST_ENABLED=false).");
      return;
    }

    if (!this.sender) {
      this.logger.warn("TELEGRAM_BOT_TOKEN tidak diset — broadcaster outbound tidak dapat mengirim pesan.");
    }

    // Ambil advisory lock
    if (this.databaseUrl) {
      try {
        this.lock = await this.openLock(this.databaseUrl, this.advisoryLockKey, {
          logger: {
            warn: (m: string) => this.logger.warn(m),
            info: (m: string) => this.logger.info(m),
            error: (m: string) => this.logger.error(m),
          },
        });
        if (!this.lock.acquired) {
          this.logger.warn(
            `Proses broadcaster lain sedang memegang lock ${this.advisoryLockKey}; proses ini menunggu/pasif.`,
          );
        }
      } catch (err) {
        this.logger.warn(`Gagal mengambil advisory lock: ${err instanceof Error ? err.message : String(err)}`);
        this.lock = undefined;
      }
    }

    this.logger.info(
      `Broadcaster aktif (digest: [${this.digestTimes.join(", ")}] ${this.timeZone}, lang: ${this.lang}, poll: ${this.pollIntervalSec}s)`,
    );

    // Jalankan siklus pertama segera
    void this.pollOnce();

    // Jadwalkan polling tiap pollIntervalSec detik
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalSec * 1000);
  }

  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.lock) {
      await this.lock.release().catch(() => {});
      this.lock = undefined;
    }

    this.logger.info("Broadcaster dihentikan.");
  }

  /**
   * Pemicu segera saat research worker selesai menjalankan run.
   */
  public async onRunCompleted(_report?: any): Promise<void> {
    if (!this.running || !this.isEnabled) return;
    try {
      await this.pollOnce();
    } catch (err) {
      this.logger.warn(`Error onRunCompleted poll: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Eksekusi satu siklus pengecekan (digest + alert proaktif).
   * Mengembalikan jumlah pesan terkirim.
   */
  public async pollOnce(): Promise<number> {
    if (!this.isEnabled) return 0;

    // Jika databaseUrl disediakan, broadcaster harus memegang advisory lock aktif untuk mengirim.
    // Bila lock belum didapat (error/pasif di start) atau hilang (isLost), coba ulang ambil lock.
    if (this.databaseUrl) {
      if (!this.lock || !this.lock.acquired || this.lock.isLost()) {
        try {
          if (this.lock) {
            await this.lock.release().catch(() => {});
            this.lock = undefined;
          }
          const candidate = await this.openLock(this.databaseUrl, this.advisoryLockKey, {
            logger: {
              warn: (m: string) => this.logger.warn(m),
              info: (m: string) => this.logger.info(m),
              error: (m: string) => this.logger.error(m),
            },
          });
          this.lock = candidate;
          if (!candidate.acquired) {
            // Masih dipegang proses lain, tetap pasif
            return 0;
          }
          this.logger.info(`Berhasil mengambil advisory lock ${this.advisoryLockKey}; broadcaster kini aktif.`);
        } catch (err) {
          this.logger.warn(`Gagal mencoba mengambil advisory lock: ${err instanceof Error ? err.message : String(err)}`);
          this.lock = undefined;
          return 0;
        }
      }
    } else if (this.lock && !this.lock.acquired) {
      return 0;
    }

    const now = this.getNow();
    const chainId = 42161; // Arbitrum One default
    let totalSent = 0;

    try {
      const recipients = await this.fetchRecipients();
      if (recipients.length === 0) {
        return 0;
      }

      const [assessments, signals, latestReport] = await Promise.all([
        this.fetchAssessments(chainId, now),
        this.fetchActiveSignals(chainId, now),
        this.fetchLatestReport(chainId),
      ]);

      // 1. Evaluasi jadwal Digest
      totalSent += await this.evaluateDigest(recipients, assessments, signals, latestReport, now);

      // 2. Evaluasi Alert Regime (naik segera, turun setelah hysteresis 1 jam)
      totalSent += await this.evaluateRegimeAlerts(recipients, assessments, now);

      // 3. Evaluasi Alert Sinyal Kritis (T10, T4, T7, T8 berat)
      totalSent += await this.evaluateSignalAlerts(recipients, signals, now);
    } catch (err) {
      this.logger.error(`Error during broadcast poll: ${err instanceof Error ? err.message : String(err)}`);
    }

    return totalSent;
  }

  /**
   * Evaluasi jadwal digest harian.
   */
  private async evaluateDigest(
    recipients: Recipient[],
    assessments: RiskAssessment[],
    signals: Signal[],
    latestReport: FetchedReportLike | null,
    now: Date,
  ): Promise<number> {
    const { dateStr, timeStr } = getLocalParts(now, this.timeZone);

    for (const targetSlot of this.digestTimes) {
      // Periksa apakah waktu saat ini cocok dengan slot jadwal (mis. "08:00")
      // Karena poller berjalan tiap 60s, pengecekan waktu HH:mm menangkap menit tersebut
      if (timeStr === targetSlot) {
        const dedupeKey = `digest:${dateStr}:${targetSlot}`;
        const isDeduped = await this.isDeduped(dedupeKey, 0, now);
        if (!isDeduped) {
          const message = digestView({
            dateStr,
            assessments,
            signals,
            latestReport,
            lang: this.lang,
          });

          return await this.dispatchBroadcast("digest", dedupeKey, message, recipients);
        }
      }
    }

    return 0;
  }

  /**
   * Kirim digest secara eksplisit (dipakai oleh CLI tahansoe broadcast digest).
   */
  public async sendDigest(options: { dryRun?: boolean; force?: boolean } = {}): Promise<{
    message: string;
    recipientsCount: number;
    sentCount: number;
    failedCount: number;
  }> {
    const now = this.getNow();
    const chainId = 42161;
    const { dateStr, timeStr } = getLocalParts(now, this.timeZone);

    const [recipients, assessments, signals, latestReport] = await Promise.all([
      this.fetchRecipients(),
      this.fetchAssessments(chainId, now),
      this.fetchActiveSignals(chainId, now),
      this.fetchLatestReport(chainId),
    ]);

    const message = digestView({
      dateStr,
      assessments,
      signals,
      latestReport,
      lang: this.lang,
    });

    if (options.dryRun) {
      return {
        message,
        recipientsCount: recipients.length,
        sentCount: 0,
        failedCount: 0,
      };
    }

    const dedupeKey = options.force
      ? `digest:${dateStr}:${timeStr}:${now.getTime()}`
      : `digest:${dateStr}:${timeStr}`;

    const sentCount = await this.dispatchBroadcast("digest", dedupeKey, message, recipients);
    return {
      message,
      recipientsCount: recipients.length,
      sentCount,
      failedCount: recipients.length - sentCount,
    };
  }

  /**
   * Evaluasi perubahan regime per aset (naik segera, turun hysteresis 1 jam).
   */
  private async evaluateRegimeAlerts(
    recipients: Recipient[],
    assessments: RiskAssessment[],
    now: Date,
  ): Promise<number> {
    const nowMs = now.getTime();
    let sent = 0;

    for (const a of assessments) {
      const asset = a.asset.toUpperCase();
      const currentRegime = a.regime;
      const currentLevel = REGIME_LEVELS[currentRegime] ?? 0;
      const prevRecord = this.assetRegimes[asset];

      if (!prevRecord) {
        // Observasi awal
        this.assetRegimes[asset] = {
          regime: currentRegime,
          since: nowMs,
          lastObserved: nowMs,
        };
        continue;
      }

      const prevRegime = prevRecord.regime;
      const prevLevel = REGIME_LEVELS[prevRegime] ?? 0;

      // Kasus 1: Regime Naik
      if (currentLevel > prevLevel) {
        const dedupeKey = `alert:regime:${asset}:${currentRegime}`;
        const severity = currentLevel / 3;

        const isDeduped = await this.isDeduped(dedupeKey, severity, now);
        if (!isDeduped) {
          const message = regimeUpAlert(
            asset,
            prevRegime,
            currentRegime,
            a.explanation || "Faktor risiko on-chain meningkat.",
            a.createdAt ?? now,
            this.lang,
          );

          const count = await this.dispatchBroadcast("regime", dedupeKey, message, recipients);
          if (count > 0) {
            this.alertSeverities.set(dedupeKey, severity);
            sent += count;
          }
        }

        this.assetRegimes[asset] = {
          regime: currentRegime,
          since: nowMs,
          lastObserved: nowMs,
        };
        continue;
      }

      // Kasus 2: Regime Turun (Hysteresis >= 1 jam bertahan)
      if (currentLevel < prevLevel) {
        const durationHeld = nowMs - prevRecord.since;

        if (durationHeld >= HYSTERESIS_DOWN_HOLD_MS) {
          const dedupeKey = `alert:regime:${asset}:${currentRegime}`;
          const isDeduped = await this.isDeduped(dedupeKey, 0, now);

          if (!isDeduped) {
            const message = regimeDownAlert(
              asset,
              currentRegime,
              a.explanation || "Kondisi risiko stabil dan normal kembali.",
              a.createdAt ?? now,
              this.lang,
            );

            const count = await this.dispatchBroadcast("regime", dedupeKey, message, recipients);
            if (count > 0) {
              this.alertSeverities.set(dedupeKey, 0);
              sent += count;
            }
          }

          this.assetRegimes[asset] = {
            regime: currentRegime,
            since: nowMs,
            lastObserved: nowMs,
          };
        }
        continue;
      }

      // Regime tetap
      prevRecord.lastObserved = nowMs;
    }

    return sent;
  }

  /**
   * Evaluasi sinyal kritis deterministik.
   */
  private async evaluateSignalAlerts(
    recipients: Recipient[],
    signals: Signal[],
    now: Date,
  ): Promise<number> {
    let sent = 0;

    for (const s of signals) {
      // Alert kritis hanya dari modul deterministik. Sinyal RESEARCH (AI) boleh menyebut
      // path T7/T10/dst. tanpa data on-chain yang mengonfirmasi, dan tiap run memakai id
      // baru sehingga lolos dedupe (bug spam 24 Okt 2026).
      if (s.module !== "ORACLE" && s.module !== "ONCHAIN") continue;

      let alertKind: "sequencer" | "depeg" | "pool" | "oracle" | undefined;

      // 1. Sequencer down (ORACLE T10)
      if (s.module === "ORACLE" && s.paths?.includes("T10")) {
        alertKind = "sequencer";
      }
      // 2. Stablecoin depeg (ONCHAIN T4)
      else if (s.module === "ONCHAIN" && s.paths?.includes("T4")) {
        alertKind = "depeg";
      }
      // 3. Pool kering (T7: carry.ts menambahkan path ini hanya bila utilization >= 98%).
      // Jangan mencocokkan angka "98" di teks evidence: APR "4.98%" ikut terdeteksi.
      else if (s.module === "ONCHAIN" && s.paths?.includes("T7")) {
        alertKind = "pool";
      }
      // 4. ORACLE T8 berat (severity >= 0.6)
      else if (s.module === "ORACLE" && s.paths?.includes("T8") && s.severity >= 0.6) {
        alertKind = "oracle";
      }

      if (!alertKind) continue;

      const dedupeKey = `alert:signal:${s.dedupeKey || s.id}`;
      const isDeduped = await this.isDeduped(dedupeKey, s.severity, now);
      if (isDeduped) continue;

      const message = signalAlert(alertKind, s, s.observedAt ?? now, this.lang);
      const count = await this.dispatchBroadcast("signal", dedupeKey, message, recipients);
      if (count > 0) {
        this.alertSeverities.set(dedupeKey, s.severity);
        sent += count;
      }
    }

    return sent;
  }

  /**
   * Kirim pesan broadcast ke seluruh penerima aktif, tangani 403, dan log ke tabel broadcasts.
   */
  public async dispatchBroadcast(
    kind: string,
    dedupeKey: string,
    message: string,
    recipients: Recipient[],
  ): Promise<number> {
    if (!this.sender) {
      this.logger.warn(`Pesan broadcast (${kind}) batal dikirim: Telegram sender tidak tersedia.`);
      return 0;
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const r of recipients) {
      try {
        await this.sender.send(r.telegramUserId, message, { parseMode: "HTML" });
        sentCount++;
      } catch (err) {
        failedCount++;
        const isBlocked =
          (err instanceof TelegramApiError && err.isBlockedOrNotFound) ||
          (err instanceof Error && /403|blocked|deactivated|not found/i.test(err.message));

        if (isBlocked) {
          this.logger.info(`Akun Telegram ${r.telegramUserId} memblokir bot / tidak aktif (403), menonaktifkan akun.`);
          await deactivateRecipient(r.telegramUserId, {
            db: this.db,
            deactivateRecipient: this.loaders.deactivateRecipient,
          });
        } else {
          this.logger.warn(`Gagal kirim pesan broadcast ke chat ${r.telegramUserId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Catat log broadcast ke DB (tabel broadcasts)
    try {
      await this.recordBroadcast({
        kind,
        dedupeKey,
        message,
        recipientsCount: recipients.length,
        sentCount,
        failedCount,
      });
    } catch (err) {
      this.logger.warn(`Gagal mencatat broadcast ke DB: ${err instanceof Error ? err.message : String(err)}`);
    }

    return sentCount;
  }

  /**
   * Cek apakah dedupeKey sudah terkirim dalam 6 jam terakhir dan severity belum naik.
   */
  public async isDeduped(dedupeKey: string, severity: number, now: Date): Promise<boolean> {
    if (this.loaders.isDeduped) {
      return await this.loaders.isDeduped(dedupeKey, severity, now);
    }

    const db = this.db ?? (this.databaseUrl ? getDb() : null);
    if (!db) return false;

    try {
      const rows = await db
        .select({
          createdAt: broadcasts.createdAt,
        })
        .from(broadcasts)
        .where(eq(broadcasts.dedupeKey, dedupeKey))
        .limit(1);

      if (rows.length === 0) {
        return false;
      }

      const row = rows[0]!;
      const ageMs = now.getTime() - new Date(row.createdAt).getTime();
      const maxAgeMs = DEFAULT_DEDUPE_HOURS * 60 * 60 * 1000;

      // Jendela dedupe 6 jam sudah lewat -> boleh kirim ulang
      if (ageMs >= maxAgeMs) {
        return false;
      }

      // Dalam jendela 6 jam, hanya kirim jika severity naik. Severity terakhir hanya ada
      // di memori: setelah restart anggap sama (jangan kirim ulang semua alert 6 jam terakhir).
      const prevSeverity = this.alertSeverities.get(dedupeKey);
      if (prevSeverity === undefined) {
        this.alertSeverities.set(dedupeKey, severity);
        return true;
      }
      if (severity > prevSeverity) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Catat hasil broadcast ke tabel `broadcasts`.
   */
  public async recordBroadcast(params: {
    kind: string;
    dedupeKey: string;
    message: string;
    recipientsCount: number;
    sentCount: number;
    failedCount: number;
  }): Promise<void> {
    if (this.loaders.recordBroadcast) {
      await this.loaders.recordBroadcast(params);
      return;
    }

    const db = this.db ?? (this.databaseUrl ? getDb() : null);
    if (!db) return;

    try {
      await db
        .insert(broadcasts)
        .values({
          kind: params.kind,
          dedupeKey: params.dedupeKey,
          message: params.message,
          recipientsCount: params.recipientsCount,
          sentCount: params.sentCount,
          failedCount: params.failedCount,
        })
        .onConflictDoUpdate({
          target: broadcasts.dedupeKey,
          set: {
            message: params.message,
            recipientsCount: params.recipientsCount,
            sentCount: params.sentCount,
            failedCount: params.failedCount,
            createdAt: new Date(),
          },
        });
    } catch (err) {
      this.logger.warn(`Gagal insert ke tabel broadcasts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Fetchers
  // -------------------------------------------------------------------------

  public async fetchRecipients(): Promise<Recipient[]> {
    return await getActiveRecipients({
      db: this.db,
      loadRecipients: this.loaders.loadRecipients,
    });
  }

  private async fetchAssessments(chainId: number, now: Date): Promise<RiskAssessment[]> {
    if (this.loaders.loadAssessments) {
      return await this.loaders.loadAssessments(chainId, now);
    }
    const db = this.db ?? (this.databaseUrl ? getDb() : null);
    if (!db) return [];

    try {
      const rows = await db
        .select()
        .from(riskAssessments)
        .where(and(eq(riskAssessments.chainId, chainId), gt(riskAssessments.validUntil, now)))
        .orderBy(desc(riskAssessments.createdAt))
        .limit(20);

      const byAsset = new Map<string, RiskAssessment>();
      for (const r of rows) {
        const asset = (r.asset as string).toUpperCase();
        if (!byAsset.has(asset)) {
          byAsset.set(asset, {
            asset: r.asset as string,
            chainId: r.chainId as number,
            regime: r.regime as Regime,
            riskScore: Number(r.riskScore),
            drawdownEstimate: {
              h4: Number(r.drawdownH4 ?? 0),
              h24: Number(r.drawdownH24 ?? 0),
            },
            recommendedTriggerHF: Number(r.recommendedTriggerHf),
            recommendedTargetHF: Number(r.recommendedTargetHf),
            drivers: Array.isArray(r.drivers) ? (r.drivers as Signal[]) : [],
            explanation: (r.explanation as string) || "",
            modelVersion: (r.modelVersion as string) || "1.0",
            validUntil: r.validUntil as Date,
            createdAt: r.createdAt as Date,
          });
        }
      }
      return Array.from(byAsset.values());
    } catch {
      return [];
    }
  }

  private async fetchActiveSignals(chainId: number, now: Date): Promise<Signal[]> {
    if (this.loaders.loadActiveSignals) {
      return await this.loaders.loadActiveSignals(chainId, now);
    }
    const db = this.db ?? (this.databaseUrl ? getDb() : null);
    if (!db) return [];

    try {
      const rows = await db
        .select()
        .from(signalsTable)
        .where(and(eq(signalsTable.chainId, chainId), gt(signalsTable.expiresAt, now)))
        .orderBy(desc(signalsTable.observedAt))
        .limit(100);

      const parsed = rows.map((r: any) =>
        rowToSignal({
          id: r.id as string,
          module: r.module as string,
          paths: r.paths,
          assets: r.assets,
          direction: r.direction as string,
          severity: r.severity as string | number,
          confidence: r.confidence as string | number,
          horizonHours: Number(r.horizonHours),
          observedAt: r.observedAt as Date,
          expiresAt: r.expiresAt as Date,
          evidence: r.evidence,
        }),
      );

      return dedupeSignals(parsed);
    } catch {
      return [];
    }
  }

  private async fetchLatestReport(chainId: number): Promise<FetchedReportLike | null> {
    if (this.loaders.loadLatestReport) {
      return await this.loaders.loadLatestReport();
    }
    const db = this.db ?? (this.databaseUrl ? getDb() : null);
    if (!db) return null;

    try {
      const rows = await db
        .select()
        .from(researchReports)
        .where(eq(researchReports.chainId, chainId))
        .orderBy(desc(researchReports.createdAt))
        .limit(1);

      if (rows.length === 0) return null;
      const r = rows[0]!;
      return {
        createdAt: r.createdAt as Date,
        report: r.report as any,
      };
    } catch {
      return null;
    }
  }
}

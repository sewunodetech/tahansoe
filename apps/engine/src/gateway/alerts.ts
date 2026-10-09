/**
 * Mesin Deteksi & Pengiriman Alert Risiko Proaktif (spec m3-channel-gateway §3.4, §7).
 *
 * Poller membaca DB secara berkala (tiap GATEWAY_ALERT_POLL_SEC, default 60):
 *  1. Regime naik per aset (segera)
 *  2. Regime turun per aset setelah bertahan >= 1 jam (hysteresis)
 *  3. Sinyal deterministik baru:
 *     - ORACLE T10 (sequencer down)
 *     - ONCHAIN T4 (stablecoin depeg)
 *     - T7 (reserve liquidity kering / util >= 98%)
 *     - ORACLE T8 berat (severity >= 0.6)
 *  4. Ringkasan harian opsional
 *
 * Dedupe 6 jam per alert key kecuali severity naik.
 * Footer wajib: "informational · not investment advice".
 */

import type { Signal, RiskAssessment, Regime } from "@tahansoe/domain";
import type { ChannelAdapter } from "./core/adapter.ts";
import type { GatewayRuntimeState } from "./core/state.ts";
import {
  isAlertDeduped,
  recordSentAlert,
  saveGatewayState,
  getUtcDateString,
  DEFAULT_DEDUPE_HOURS,
} from "./core/state.ts";
import {
  loadSettings,
  isChatAllowed,
  isChatSubscribed,
  getChatAlertPreferences,
  type AlertType,
  type Settings,
} from "../settings/settings.ts";
import { fmtTime } from "../cli/render.ts";
import { CHAT_FOOTER } from "../cli/repl/chat.ts";
import { alertActionKeyboard } from "./telegram/adapter.ts";

export const DEFAULT_ALERT_POLL_SEC = 60;
export const HYSTERESIS_DOWN_HOLD_MS = 60 * 60 * 1000; // 1 jam

export interface AlertEngineLoaders {
  loadAssessments?: (chainId: number, now: Date) => Promise<RiskAssessment[]>;
  loadActiveSignals?: (chainId: number, now: Date) => Promise<Signal[]>;
}

export interface AlertPollerOptions {
  adapter: ChannelAdapter;
  state: GatewayRuntimeState;
  statePath?: string;
  settingsPath?: string;
  env?: NodeJS.ProcessEnv;
  pollIntervalSec?: number;
  loaders?: AlertEngineLoaders;
  logger?: (msg: string) => void;
  now?: () => Date;
}

const REGIME_LEVELS: Record<Regime, number> = {
  CALM: 0,
  ELEVATED: 1,
  STRESSED: 2,
  CRISIS: 3,
};

export class AlertPoller {
  private readonly adapter: ChannelAdapter;
  private readonly state: GatewayRuntimeState;
  private readonly statePath?: string;
  private readonly settingsPath?: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly pollIntervalSec: number;
  private readonly loaders: AlertEngineLoaders;
  private readonly logger: (msg: string) => void;
  private readonly getNow: () => Date;

  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(options: AlertPollerOptions) {
    this.adapter = options.adapter;
    this.state = options.state;
    this.statePath = options.statePath;
    this.settingsPath = options.settingsPath;
    this.env = options.env ?? process.env;
    this.pollIntervalSec =
      options.pollIntervalSec ??
      (Number(this.env.GATEWAY_ALERT_POLL_SEC) || DEFAULT_ALERT_POLL_SEC);
    this.loaders = options.loaders ?? {};
    this.logger = options.logger ?? (() => {});
    this.getNow = options.now ?? (() => new Date());
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    this.logger(`[Alerts] Poller started (every ${this.pollIntervalSec}s)`);
    // Jalankan segera sekali di awal, lalu jadwalkan interval
    void this.pollOnce();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalSec * 1000);
  }

  public stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger("[Alerts] Poller stopped");
  }

  /**
   * Eksekusi satu kali siklus deteksi alert. Mengembalikan jumlah alert yang dikirim.
   */
  public async pollOnce(): Promise<number> {
    const now = this.getNow();
    const nowMs = now.getTime();
    const chainId = 42161; // Arbitrum One default

    let sentCount = 0;

    try {
      const { settings } = await loadSettings(this.settingsPath);

      // Ambil assessments dan active signals dari loaders atau DB
      const [assessments, signals] = await Promise.all([
        this.fetchAssessments(chainId, now),
        this.fetchActiveSignals(chainId, now),
      ]);

      // 1. Evaluasi alert perubahan regime per aset
      sentCount += await this.evaluateRegimeAlerts(assessments, settings, nowMs);

      // 2. Evaluasi alert sinyal deterministik (T10, T4, T7, T8 berat)
      sentCount += await this.evaluateSignalAlerts(signals, settings, nowMs);

      // 3. Evaluasi ringkasan harian
      sentCount += await this.evaluateDailySummary(assessments, signals, settings, now);

      if (sentCount > 0 && this.statePath) {
        await saveGatewayState(this.state, this.statePath).catch(() => {});
      }
    } catch (err) {
      this.logger(`[Alerts] Error during alert poll: ${err instanceof Error ? err.message : String(err)}`);
    }

    return sentCount;
  }

  private async evaluateRegimeAlerts(
    assessments: RiskAssessment[],
    settings: Settings,
    nowMs: number,
  ): Promise<number> {
    let sent = 0;

    for (const a of assessments) {
      const asset = a.asset.toUpperCase();
      const currentRegime = a.regime;
      const currentLevel = REGIME_LEVELS[currentRegime] ?? 0;
      const prevRecord = this.state.assetRegimes[asset];

      if (!prevRecord) {
        // Catat regime awal tanpa mengirim alert
        this.state.assetRegimes[asset] = {
          regime: currentRegime,
          since: nowMs,
          lastObserved: nowMs,
        };
        continue;
      }

      const prevRegime = prevRecord.regime as Regime;
      const prevLevel = REGIME_LEVELS[prevRegime] ?? 0;

      // Kasus 1: Regime Naik
      if (currentLevel > prevLevel) {
        const dedupeKey = `alert:regime:${asset}:${currentRegime}`;
        const severity = currentLevel / 3;

        if (!isAlertDeduped(this.state, dedupeKey, severity, nowMs, DEFAULT_DEDUPE_HOURS)) {
          const headline = `⚠ ${asset}: ${prevRegime} → ${currentRegime}`;
          const explanation = a.explanation || "Risk factors elevated on-chain.";
          const timeStr = `${fmtTime(a.createdAt ?? new Date(nowMs))} UTC`;

          const message =
            `${headline}\n\n` +
            `Cause: ${explanation}\n` +
            `Time: ${timeStr}\n\n` +
            `${CHAT_FOOTER}`;

          const delivered = await this.broadcastAlert("regime", message, settings);
          if (delivered > 0) {
            recordSentAlert(this.state, dedupeKey, severity, nowMs);
            sent += delivered;
          }
        }

        // Perbarui state regime aset
        this.state.assetRegimes[asset] = {
          regime: currentRegime,
          since: nowMs,
          lastObserved: nowMs,
        };
        continue;
      }

      // Kasus 2: Regime Turun (dengan hysteresis >= 1 jam bertahan di level tinggi)
      if (currentLevel < prevLevel) {
        const durationHeld = nowMs - prevRecord.since;

        if (durationHeld >= HYSTERESIS_DOWN_HOLD_MS) {
          const dedupeKey = `alert:regime:${asset}:${currentRegime}`;

          if (!isAlertDeduped(this.state, dedupeKey, 0, nowMs, DEFAULT_DEDUPE_HOURS)) {
            const headline = `✓ ${asset} returned to ${currentRegime}`;
            const explanation = a.explanation || "Risk conditions normalized and held steady.";
            const timeStr = `${fmtTime(a.createdAt ?? new Date(nowMs))} UTC`;

            const message =
              `${headline}\n\n` +
              `Status: ${explanation}\n` +
              `Time: ${timeStr}\n\n` +
              `${CHAT_FOOTER}`;

            const delivered = await this.broadcastAlert("regime", message, settings);
            if (delivered > 0) {
              recordSentAlert(this.state, dedupeKey, 0, nowMs);
              sent += delivered;
            }
          }

          // Perbarui state regime aset setelah penurunan
          this.state.assetRegimes[asset] = {
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

  private async evaluateSignalAlerts(
    signals: Signal[],
    settings: Settings,
    nowMs: number,
  ): Promise<number> {
    let sent = 0;

    for (const s of signals) {
      let alertType: AlertType | undefined;
      let headline = "";

      // 1. Sequencer down (ORACLE T10)
      if (s.module === "ORACLE" && s.paths?.includes("T10")) {
        alertType = "sequencer";
        headline = "🚨 Sequencer Arbitrum DOWN — repay cannot be performed until recovered";
      }
      // 2. Stablecoin depeg (ONCHAIN T4)
      else if (s.module === "ONCHAIN" && s.paths?.includes("T4")) {
        alertType = "depeg";
        const assetName = s.assets[0] ?? "Stablecoin";
        headline = `🚨 Stablecoin ${assetName} depeg detected`;
      }
      // 3. Pool kering (T7 / util >= 98%)
      else if (
        s.paths?.includes("T7") ||
        (s.module === "ONCHAIN" && s.evidence?.some((e) => e.title?.toLowerCase().includes("utilization") && (e.title.includes("98") || e.title.includes("99"))))
      ) {
        alertType = "pool";
        const poolAsset = s.assets[0] ?? "Reserve";
        headline = `⚠ Pool ${poolAsset} liquidity constrained (utilization >= 98%)`;
      }
      // 4. ORACLE T8 berat (severity >= 0.6)
      else if (s.module === "ORACLE" && s.paths?.includes("T8") && s.severity >= 0.6) {
        alertType = "oracle";
        const asset = s.assets[0] ?? "Oracle";
        headline = `🚨 Severe oracle lag/deviation on ${asset}`;
      }

      if (!alertType) continue;

      const dedupeKey = `alert:signal:${s.dedupeKey || s.id}`;

      if (isAlertDeduped(this.state, dedupeKey, s.severity, nowMs, DEFAULT_DEDUPE_HOURS)) {
        continue;
      }

      const evidenceSummary =
        s.evidence?.map((e) => e.title).filter(Boolean).join("\n• ") ||
        "Deterministic signal threshold breached.";
      const timeStr = `${fmtTime(s.observedAt ?? new Date(nowMs))} UTC`;

      const message =
        `${headline}\n\n` +
        `Evidence:\n• ${evidenceSummary}\n\n` +
        `Observed: ${timeStr}\n\n` +
        `${CHAT_FOOTER}`;

      const delivered = await this.broadcastAlert(alertType, message, settings);
      if (delivered > 0) {
        recordSentAlert(this.state, dedupeKey, s.severity, nowMs);
        sent += delivered;
      }
    }

    return sent;
  }

  private async evaluateDailySummary(
    assessments: RiskAssessment[],
    signals: Signal[],
    settings: Settings,
    now: Date,
  ): Promise<number> {
    const today = getUtcDateString(now);
    if (this.state.lastDailySummaryDate === today) {
      return 0;
    }

    const eligibleChats = this.getRecipients("daily", settings);
    if (eligibleChats.length === 0) {
      return 0;
    }

    const regimeLines = assessments.map((a) => `• ${a.asset}: ${a.regime} (score ${a.riskScore.toFixed(2)})`);
    const summaryBody =
      `📊 Tahansoe Daily Risk Summary (${today})\n\n` +
      `Current Regimes:\n${regimeLines.join("\n") || "• No active asset assessments"}\n\n` +
      `Active Signals: ${signals.length}\n` +
      `Carry & Liquidity Status: Monitored\n\n` +
      `${CHAT_FOOTER}`;

    let sent = 0;
    for (const chatId of eligibleChats) {
      try {
        await this.adapter.send(chatId, summaryBody);
        sent++;
      } catch (err) {
        this.logger(`[Alerts] Error sending daily summary to ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.state.lastDailySummaryDate = today;
    return sent;
  }

  private getRecipients(alertType: AlertType, settings: Settings): string[] {
    const chatIds = new Set<string>();

    // Ambil dari settings.gateway.channels.telegram.allowedChats
    const allowed = settings.gateway?.channels?.telegram?.allowedChats ?? [];
    for (const c of allowed) {
      const idStr = String(c.id).trim();
      if (isChatAllowed(idStr, settings, this.env.TELEGRAM_ALLOWED_CHAT_IDS)) {
        if (isChatSubscribed(idStr, settings)) {
          const prefs = getChatAlertPreferences(idStr, settings);
          if (prefs[alertType] === true) {
            chatIds.add(idStr);
          }
        }
      }
    }

    // Ambil dari TELEGRAM_ALLOWED_CHAT_IDS
    if (this.env.TELEGRAM_ALLOWED_CHAT_IDS) {
      const envIds = this.env.TELEGRAM_ALLOWED_CHAT_IDS.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const id of envIds) {
        if (isChatSubscribed(id, settings)) {
          const prefs = getChatAlertPreferences(id, settings);
          if (prefs[alertType] === true) {
            chatIds.add(id);
          }
        }
      }
    }

    return Array.from(chatIds);
  }

  private async broadcastAlert(
    alertType: AlertType,
    message: string,
    settings: Settings,
  ): Promise<number> {
    const recipients = this.getRecipients(alertType, settings);
    const replyMarkup = alertActionKeyboard(alertType);
    let count = 0;

    for (const chatId of recipients) {
      try {
        await this.adapter.send(chatId, message, { replyMarkup });
        count++;
      } catch (err) {
        this.logger(`[Alerts] Failed to send alert to ${chatId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return count;
  }

  private async fetchAssessments(chainId: number, now: Date): Promise<RiskAssessment[]> {
    if (this.loaders.loadAssessments) {
      return await this.loaders.loadAssessments(chainId, now);
    }
    if (!process.env.DATABASE_URL) return [];
    try {
      const { getDb, riskAssessments } = await import("@tahansoe/db");
      const { desc, eq, and, gt } = await import("drizzle-orm");
      const db = getDb();
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
    if (!process.env.DATABASE_URL) return [];
    try {
      const { getDb, signals: signalsTable } = await import("@tahansoe/db");
      const { desc, eq, gt, and } = await import("drizzle-orm");
      const { rowToSignal, dedupeSignals } = await import("../signals/dedupe.ts");
      const db = getDb();
      const rows = await db
        .select()
        .from(signalsTable)
        .where(and(eq(signalsTable.chainId, chainId), gt(signalsTable.expiresAt, now)))
        .orderBy(desc(signalsTable.observedAt))
        .limit(100);

      const parsed = rows.map((r) =>
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
}

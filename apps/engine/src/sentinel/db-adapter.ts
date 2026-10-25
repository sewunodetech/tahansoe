import { eq, and, isNull, isNotNull, sql, desc, gte } from "drizzle-orm";
import type { Db, NewProtectionPlanRow } from "@tahansoe/db";
import {
  users,
  policies,
  positions,
  eventCursors,
  notificationLogs,
  telegramAccounts,
  protectionPlans,
  riskAssessments,
} from "@tahansoe/db";
import type { Address, Regime } from "@tahansoe/domain";
import type { EventSyncDatabase } from "./event-sync.ts";
import type { PolicyRecord } from "./types.ts";
import { buildPositionKey } from "./adapters.ts";

export interface SentinelDatabase extends EventSyncDatabase {
  loadActivePolicies(chainId: number): Promise<PolicyRecord[]>;
  upsertPosition(data: {
    userId: string;
    protocol: "aave-v3" | "morpho-blue";
    chainId: number;
    healthFactor: string;
    liquidationThreshold: string;
    collateralValueUsd: string;
    debtValueUsd: string;
    oracleSource: string;
    now: Date;
    marketId?: string;
  }): Promise<string>;
  linkPolicyPosition(policyId: string, positionId: string): Promise<void>;
  getLastNotification(
    userId: string,
    type: "HF_WARNING" | "HF_CRITICAL" | "RESERVE_LOW",
  ): Promise<{ sentAt: Date } | null>;
  insertProtectionPlan?(plan: NewProtectionPlanRow): Promise<void>;
  getLatestRiskAssessment?(
    chainId: number,
    asset: string,
  ): Promise<{ id: string; regime: Regime; validUntil: Date; drivers?: any } | null>;
  getSpent24h?(positionKey: string, since: Date): Promise<bigint>;
}

export class DrizzleSentinelDatabase implements SentinelDatabase {
  constructor(private readonly db: Db) {}

  async getCursor(
    chainId: number,
    contractAddress: Address,
    cursorName = "events",
  ): Promise<bigint | null> {
    const id = `${chainId}:${contractAddress.toLowerCase()}:${cursorName}`;
    const rows = await this.db
      .select({ lastBlockNumber: eventCursors.lastBlockNumber })
      .from(eventCursors)
      .where(eq(eventCursors.id, id))
      .limit(1);

    return rows.length > 0 ? rows[0]!.lastBlockNumber : null;
  }

  async setCursor(
    chainId: number,
    contractAddress: Address,
    lastBlock: bigint,
    cursorName = "events",
  ): Promise<void> {
    const id = `${chainId}:${contractAddress.toLowerCase()}:${cursorName}`;
    await this.db
      .insert(eventCursors)
      .values({
        id,
        chainId,
        contractAddress: contractAddress.toLowerCase(),
        cursorName,
        lastBlockNumber: lastBlock,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: eventCursors.id,
        set: {
          lastBlockNumber: lastBlock,
          updatedAt: new Date(),
        },
      });
  }

  async upsertUser(walletAddress: Address, chainId: number): Promise<string> {
    const addr = walletAddress.toLowerCase();
    const rows = await this.db
      .insert(users)
      .values({
        walletAddress: addr,
        chainId,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [users.walletAddress, users.chainId],
        set: {
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: users.id });

    return rows[0]!.id;
  }

  async upsertPolicy(data: {
    userId: string;
    chainId: number;
    guardianAddress: Address;
    guardianVersion: number;
    debtAsset?: Address;
    marketId?: string;
    positionKey?: string;
    protocol?: "aave-v3" | "morpho-blue";
    maxRepayPerAction: bigint;
    triggerThreshold: number;
    targetHealthFactor: number;
  }): Promise<void> {
    const gAddr = data.guardianAddress.toLowerCase();
    const dAsset = (data.debtAsset ?? data.marketId ?? "").toLowerCase();

    await this.db
      .insert(policies)
      .values({
        userId: data.userId,
        chainId: data.chainId,
        guardianAddress: gAddr,
        guardianVersion: data.guardianVersion,
        debtAsset: dAsset,
        positionKey: data.positionKey,
        maxRepayPerAction: data.maxRepayPerAction.toString(),
        triggerThreshold: data.triggerThreshold.toFixed(4),
        targetHealthFactor: data.targetHealthFactor.toFixed(4),
        isActive: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        // Dua partial unique index: klasik (position_key NULL) dan per posisi (ADR 0015).
        target: data.positionKey
          ? [policies.userId, policies.guardianAddress, policies.positionKey]
          : [policies.userId, policies.guardianAddress],
        targetWhere: data.positionKey ? isNotNull(policies.positionKey) : isNull(policies.positionKey),
        set: {
          isActive: true,
          guardianVersion: data.guardianVersion,
          debtAsset: dAsset,
          positionKey: data.positionKey,
          maxRepayPerAction: data.maxRepayPerAction.toString(),
          triggerThreshold: data.triggerThreshold.toFixed(4),
          targetHealthFactor: data.targetHealthFactor.toFixed(4),
          updatedAt: new Date(),
        },
      });
  }

  async disablePolicy(userId: string, guardianAddress: Address, positionKey?: string): Promise<void> {
    await this.db
      .update(policies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(policies.userId, userId),
          eq(policies.guardianAddress, guardianAddress.toLowerCase()),
          positionKey ? eq(policies.positionKey, positionKey) : undefined,
        ),
      );
  }

  async updateLayer2(data: {
    userId: string;
    guardianAddress: Address;
    kind: number;
    source: Address;
    maxAssets: bigint;
    positionKey?: string;
  }): Promise<void> {
    await this.db
      .update(policies)
      .set({
        layer2Kind: data.kind,
        layer2Source: data.source.toLowerCase(),
        layer2MaxAssets: data.maxAssets.toString(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(policies.userId, data.userId),
          eq(policies.guardianAddress, data.guardianAddress.toLowerCase()),
          data.positionKey ? eq(policies.positionKey, data.positionKey) : undefined,
        ),
      );
  }

  async updateLayer3(data: {
    userId: string;
    guardianAddress: Address;
    enabled: boolean;
    collateralAsset: Address;
    maxCollateral: bigint;
    maxSlippageBps: number;
    positionKey?: string;
  }): Promise<void> {
    await this.db
      .update(policies)
      .set({
        layer3Enabled: data.enabled,
        layer3CollateralAsset: data.collateralAsset.toLowerCase(),
        layer3MaxCollateral: data.maxCollateral.toString(),
        layer3MaxSlippageBps: data.maxSlippageBps,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(policies.userId, data.userId),
          eq(policies.guardianAddress, data.guardianAddress.toLowerCase()),
          data.positionKey ? eq(policies.positionKey, data.positionKey) : undefined,
        ),
      );
  }

  async updateTriggerBand(data: {
    userId: string;
    guardianAddress: Address;
    minTriggerHf: number;
    maxTriggerHf: number;
    riskAgent: Address;
    positionKey?: string;
  }): Promise<void> {
    await this.db
      .update(policies)
      .set({
        minTriggerHf: data.minTriggerHf.toFixed(4),
        maxTriggerHf: data.maxTriggerHf.toFixed(4),
        riskAgent: data.riskAgent.toLowerCase(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(policies.userId, data.userId),
          eq(policies.guardianAddress, data.guardianAddress.toLowerCase()),
          data.positionKey ? eq(policies.positionKey, data.positionKey) : undefined,
        ),
      );
  }

  async updateDynamicTrigger(data: {
    userId: string;
    guardianAddress: Address;
    dynamicTriggerHf: number;
    validUntil: Date;
    positionKey?: string;
  }): Promise<void> {
    await this.db
      .update(policies)
      .set({
        dynamicTriggerHf: data.dynamicTriggerHf.toFixed(4),
        dynamicValidUntil: data.validUntil,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(policies.userId, data.userId),
          eq(policies.guardianAddress, data.guardianAddress.toLowerCase()),
          data.positionKey ? eq(policies.positionKey, data.positionKey) : undefined,
        ),
      );
  }

  async getLinkedTelegramAccounts(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ telegramUserId: telegramAccounts.telegramUserId })
      .from(telegramAccounts)
      .where(
        and(
          eq(telegramAccounts.userId, userId),
          eq(telegramAccounts.isActive, true),
        ),
      );

    return rows.map((r) => r.telegramUserId.toString());
  }

  async recordNotificationLog(data: {
    userId: string;
    type: "HF_WARNING" | "HF_CRITICAL" | "EXECUTION_SUCCESS" | "EXECUTION_FAILED" | "LINK_CONFIRMED" | "RESERVE_LOW";
    message: string;
    deliveredOk: boolean;
  }): Promise<void> {
    await this.db.insert(notificationLogs).values({
      userId: data.userId,
      type: data.type,
      message: data.message,
      deliveredOk: data.deliveredOk,
      sentAt: new Date(),
    });
  }

  async loadActivePolicies(chainId: number): Promise<PolicyRecord[]> {
    const rows = await this.db
      .select({
        id: policies.id,
        userId: policies.userId,
        walletAddress: users.walletAddress,
        chainId: policies.chainId,
        guardianAddress: policies.guardianAddress,
        guardianVersion: policies.guardianVersion,
        debtAsset: policies.debtAsset,
        maxRepayPerAction: policies.maxRepayPerAction,
        triggerThreshold: policies.triggerThreshold,
        targetHealthFactor: policies.targetHealthFactor,
        isActive: policies.isActive,
        minTriggerHf: policies.minTriggerHf,
        maxTriggerHf: policies.maxTriggerHf,
        riskAgent: policies.riskAgent,
        dynamicTriggerHf: policies.dynamicTriggerHf,
        dynamicValidUntil: policies.dynamicValidUntil,
      })
      .from(policies)
      .innerJoin(users, eq(policies.userId, users.id))
      .where(
        and(
          eq(policies.chainId, chainId),
          eq(policies.isActive, true),
        ),
      );

    return rows.map((r) => {
      const gAddr = ((r.guardianAddress ?? "") as Address).toLowerCase() as Address;
      const dAsset = (r.debtAsset ?? "").toLowerCase();
      const isMorpho = dAsset.startsWith("0x") && dAsset.length === 66;
      const protocol = isMorpho ? "morpho-blue" : "aave-v3";
      const posKey = buildPositionKey({
        protocol,
        chainId: r.chainId,
        guardian: gAddr,
        key: dAsset,
      });

      return {
        id: r.id,
        userId: r.userId,
        userAddress: r.walletAddress as Address,
        chainId: r.chainId,
        guardianAddress: gAddr,
        guardianVersion: r.guardianVersion ?? 1,
        debtAsset: dAsset as Address,
        marketId: isMorpho ? dAsset : null,
        positionKey: posKey,
        protocol,
        maxRepayPerAction: r.maxRepayPerAction ? BigInt(r.maxRepayPerAction) : 0n,
        triggerThreshold: Number(r.triggerThreshold ?? "1.30"),
        targetHealthFactor: Number(r.targetHealthFactor ?? "1.60"),
        isActive: r.isActive,
        minTriggerHf: r.minTriggerHf ? Number(r.minTriggerHf) : null,
        maxTriggerHf: r.maxTriggerHf ? Number(r.maxTriggerHf) : null,
        riskAgent: (r.riskAgent as Address) ?? null,
        dynamicTriggerHf: r.dynamicTriggerHf ? Number(r.dynamicTriggerHf) : null,
        dynamicValidUntil: r.dynamicValidUntil ?? null,
      };
    });
  }

  async upsertPosition(data: {
    userId: string;
    protocol: "aave-v3" | "morpho-blue";
    chainId: number;
    healthFactor: string;
    liquidationThreshold: string;
    collateralValueUsd: string;
    debtValueUsd: string;
    oracleSource: string;
    now: Date;
    marketId?: string;
  }): Promise<string> {
    const existing = await this.db
      .select({ id: positions.id })
      .from(positions)
      .where(
        and(
          eq(positions.userId, data.userId),
          eq(positions.protocol, data.protocol),
          eq(positions.chainId, data.chainId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(positions)
        .set({
          healthFactor: data.healthFactor,
          liquidationThreshold: data.liquidationThreshold,
          collateralValueUsd: data.collateralValueUsd,
          debtValueUsd: data.debtValueUsd,
          oracleSource: data.oracleSource,
          lastCheckedAt: data.now,
          marketId: data.marketId,
        })
        .where(eq(positions.id, existing[0]!.id));

      return existing[0]!.id;
    }

    const inserted = await this.db
      .insert(positions)
      .values({
        userId: data.userId,
        protocol: data.protocol,
        chainId: data.chainId,
        marketId: data.marketId,
        healthFactor: data.healthFactor,
        liquidationThreshold: data.liquidationThreshold,
        collateralValueUsd: data.collateralValueUsd,
        debtValueUsd: data.debtValueUsd,
        oracleSource: data.oracleSource,
        lastCheckedAt: data.now,
      })
      .returning({ id: positions.id });

    return inserted[0]!.id;
  }

  async linkPolicyPosition(policyId: string, positionId: string): Promise<void> {
    await this.db
      .update(policies)
      .set({ positionId })
      .where(eq(policies.id, policyId));
  }

  async getLastNotification(
    userId: string,
    type: "HF_WARNING" | "HF_CRITICAL" | "RESERVE_LOW",
  ): Promise<{ sentAt: Date } | null> {
    const rows = await this.db
      .select({ sentAt: notificationLogs.sentAt })
      .from(notificationLogs)
      .where(
        and(
          eq(notificationLogs.userId, userId),
          eq(notificationLogs.type, type),
        ),
      )
      .orderBy(sql`${notificationLogs.sentAt} DESC`)
      .limit(1);

    return rows.length > 0 ? rows[0]! : null;
  }

  async insertProtectionPlan(plan: NewProtectionPlanRow): Promise<void> {
    await this.db.insert(protectionPlans).values(plan).onConflictDoNothing();
  }

  async getLatestRiskAssessment(
    chainId: number,
    asset: string,
  ): Promise<{ id: string; regime: Regime; validUntil: Date; drivers?: any } | null> {
    const rows = await this.db
      .select({
        id: riskAssessments.id,
        regime: riskAssessments.regime,
        validUntil: riskAssessments.validUntil,
        drivers: riskAssessments.drivers,
      })
      .from(riskAssessments)
      .where(and(eq(riskAssessments.chainId, chainId), eq(riskAssessments.asset, asset)))
      .orderBy(desc(riskAssessments.createdAt))
      .limit(1);

    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      regime: r.regime as Regime,
      validUntil: r.validUntil,
      drivers: r.drivers,
    };
  }

  async getSpent24h(positionKey: string, since: Date): Promise<bigint> {
    const rows = await this.db
      .select({ amount: protectionPlans.amount })
      .from(protectionPlans)
      .where(
        and(
          eq(protectionPlans.positionKey, positionKey),
          eq(protectionPlans.decision, "ACCEPTED"),
          gte(protectionPlans.createdAt, since),
        ),
      );

    let sum = 0n;
    for (const r of rows) {
      if (r.amount) {
        sum += BigInt(r.amount);
      }
    }
    return sum;
  }
}

/**
 * In-memory sentinel database untuk pengetesan unit deterministik dan offline.
 */
export class InMemorySentinelDatabase implements SentinelDatabase {
  public cursors = new Map<string, bigint>();
  public users = new Map<string, { id: string; walletAddress: string; chainId: number; isActive: boolean }>();
  public policies = new Map<string, PolicyRecord & { positionId?: string; sourcePrompt?: string }>();
  public positions = new Map<string, any>();
  public notifications: Array<{ userId: string; type: any; message: string; deliveredOk: boolean; sentAt: Date }> = [];
  public linkedTelegram = new Map<string, string[]>(); // userId -> telegramUserIds
  public shadowPlans: NewProtectionPlanRow[] = [];
  public latestRiskAssessment: { id: string; regime: Regime; validUntil: Date; drivers?: any } | null = null;

  private nextId = 1;

  async getCursor(chainId: number, contractAddress: Address, cursorName = "events"): Promise<bigint | null> {
    const key = `${chainId}:${contractAddress.toLowerCase()}:${cursorName}`;
    return this.cursors.get(key) ?? null;
  }

  async setCursor(chainId: number, contractAddress: Address, lastBlock: bigint, cursorName = "events"): Promise<void> {
    const key = `${chainId}:${contractAddress.toLowerCase()}:${cursorName}`;
    this.cursors.set(key, lastBlock);
  }

  async upsertUser(walletAddress: Address, chainId: number): Promise<string> {
    const addr = walletAddress.toLowerCase();
    const key = `${addr}:${chainId}`;
    let existing = this.users.get(key);
    if (!existing) {
      existing = {
        id: `user-${this.nextId++}`,
        walletAddress: addr,
        chainId,
        isActive: true,
      };
      this.users.set(key, existing);
    }
    return existing.id;
  }

  async upsertPolicy(data: {
    userId: string;
    chainId: number;
    guardianAddress: Address;
    guardianVersion: number;
    debtAsset?: Address;
    marketId?: string;
    positionKey?: string;
    protocol?: "aave-v3" | "morpho-blue";
    maxRepayPerAction: bigint;
    triggerThreshold: number;
    targetHealthFactor: number;
  }): Promise<void> {
    const isMorpho = Boolean(data.marketId) || data.protocol === "morpho-blue";
    const protocol = isMorpho ? "morpho-blue" : "aave-v3";
    const gAddr = data.guardianAddress.toLowerCase() as Address;
    // Sama dengan partial unique index di DB: Guardian klasik satu baris per user per Guardian
    // (positionKey null), Guardian per posisi satu baris per positionKey.
    const posKey = data.positionKey ?? null;
    const storeKey = posKey ?? `${data.userId}:${gAddr}`;

    const user = Array.from(this.users.values()).find((u) => u.id === data.userId);
    const existing = this.policies.get(storeKey);

    const record: PolicyRecord & { positionId?: string; sourcePrompt?: string } = {
      id: existing?.id ?? `policy-${this.nextId++}`,
      userId: data.userId,
      userAddress: (user?.walletAddress ?? "") as Address,
      chainId: data.chainId,
      guardianAddress: gAddr,
      guardianVersion: data.guardianVersion,
      debtAsset: (data.debtAsset?.toLowerCase() ?? (data.marketId?.toLowerCase() ?? "")) as Address,
      marketId: data.marketId?.toLowerCase() ?? null,
      positionKey: posKey,
      protocol,
      maxRepayPerAction: data.maxRepayPerAction,
      triggerThreshold: data.triggerThreshold,
      targetHealthFactor: data.targetHealthFactor,
      isActive: true,
      minTriggerHf: existing?.minTriggerHf ?? null,
      maxTriggerHf: existing?.maxTriggerHf ?? null,
      riskAgent: existing?.riskAgent ?? null,
      dynamicTriggerHf: existing?.dynamicTriggerHf ?? null,
      dynamicValidUntil: existing?.dynamicValidUntil ?? null,
    };

    this.policies.set(storeKey, record);
  }

  async disablePolicy(userId: string, guardianAddress: Address, positionKey?: string): Promise<void> {
    const gAddr = guardianAddress.toLowerCase();
    for (const [key, pol] of this.policies.entries()) {
      if (pol.userId === userId && pol.guardianAddress.toLowerCase() === gAddr) {
        if (!positionKey || pol.positionKey === positionKey || key === positionKey) {
          pol.isActive = false;
        }
      }
    }
  }

  async updateLayer2(data: {
    userId: string;
    guardianAddress: Address;
    kind: number;
    source: Address;
    maxAssets: bigint;
    positionKey?: string;
  }): Promise<void> {
    const gAddr = data.guardianAddress.toLowerCase();
    for (const pol of this.policies.values()) {
      if (pol.userId === data.userId && pol.guardianAddress.toLowerCase() === gAddr) {
        if (!data.positionKey || pol.positionKey === data.positionKey) {
          (pol as any).layer2Kind = data.kind;
          (pol as any).layer2Source = data.source.toLowerCase();
          (pol as any).layer2MaxAssets = data.maxAssets;
        }
      }
    }
  }

  async updateLayer3(data: {
    userId: string;
    guardianAddress: Address;
    enabled: boolean;
    collateralAsset: Address;
    maxCollateral: bigint;
    maxSlippageBps: number;
    positionKey?: string;
  }): Promise<void> {
    const gAddr = data.guardianAddress.toLowerCase();
    for (const pol of this.policies.values()) {
      if (pol.userId === data.userId && pol.guardianAddress.toLowerCase() === gAddr) {
        if (!data.positionKey || pol.positionKey === data.positionKey) {
          (pol as any).layer3Enabled = data.enabled;
          (pol as any).layer3CollateralAsset = data.collateralAsset.toLowerCase();
          (pol as any).layer3MaxCollateral = data.maxCollateral;
          (pol as any).layer3MaxSlippageBps = data.maxSlippageBps;
        }
      }
    }
  }

  async updateTriggerBand(data: {
    userId: string;
    guardianAddress: Address;
    minTriggerHf: number;
    maxTriggerHf: number;
    riskAgent: Address;
    positionKey?: string;
  }): Promise<void> {
    const gAddr = data.guardianAddress.toLowerCase();
    for (const pol of this.policies.values()) {
      if (pol.userId === data.userId && pol.guardianAddress.toLowerCase() === gAddr) {
        if (!data.positionKey || pol.positionKey === data.positionKey) {
          pol.minTriggerHf = data.minTriggerHf;
          pol.maxTriggerHf = data.maxTriggerHf;
          pol.riskAgent = data.riskAgent.toLowerCase() as Address;
        }
      }
    }
  }

  async updateDynamicTrigger(data: {
    userId: string;
    guardianAddress: Address;
    dynamicTriggerHf: number;
    validUntil: Date;
    positionKey?: string;
  }): Promise<void> {
    const gAddr = data.guardianAddress.toLowerCase();
    for (const pol of this.policies.values()) {
      if (pol.userId === data.userId && pol.guardianAddress.toLowerCase() === gAddr) {
        if (!data.positionKey || pol.positionKey === data.positionKey) {
          pol.dynamicTriggerHf = data.dynamicTriggerHf;
          pol.dynamicValidUntil = data.validUntil;
        }
      }
    }
  }

  async getLinkedTelegramAccounts(userId: string): Promise<string[]> {
    return this.linkedTelegram.get(userId) ?? [];
  }

  async recordNotificationLog(data: {
    userId: string;
    type: "HF_WARNING" | "HF_CRITICAL" | "EXECUTION_SUCCESS" | "EXECUTION_FAILED" | "LINK_CONFIRMED" | "RESERVE_LOW";
    message: string;
    deliveredOk: boolean;
  }): Promise<void> {
    this.notifications.push({
      ...data,
      sentAt: new Date(),
    });
  }

  async loadActivePolicies(chainId: number): Promise<PolicyRecord[]> {
    // Kembalikan set policy unik yang aktif
    const seen = new Set<string>();
    const result: PolicyRecord[] = [];
    for (const p of this.policies.values()) {
      const uniqueId = p.positionKey ?? `${p.userId}:${p.guardianAddress}`;
      if (p.chainId === chainId && p.isActive && !seen.has(uniqueId)) {
        seen.add(uniqueId);
        result.push(p);
      }
    }
    return result;
  }

  async upsertPosition(data: {
    userId: string;
    protocol: "aave-v3" | "morpho-blue";
    chainId: number;
    healthFactor: string;
    liquidationThreshold: string;
    collateralValueUsd: string;
    debtValueUsd: string;
    oracleSource: string;
    now: Date;
    marketId?: string;
  }): Promise<string> {
    const key = `${data.userId}:${data.protocol}:${data.chainId}:${data.marketId ?? "pool"}`;
    let pos = this.positions.get(key);
    if (!pos) {
      pos = { id: `pos-${this.nextId++}`, ...data };
      this.positions.set(key, pos);
    } else {
      Object.assign(pos, data);
    }
    return pos.id;
  }

  async linkPolicyPosition(policyId: string, positionId: string): Promise<void> {
    for (const p of this.policies.values()) {
      if (p.id === policyId) {
        p.positionId = positionId;
      }
    }
  }

  async getLastNotification(
    userId: string,
    type: "HF_WARNING" | "HF_CRITICAL" | "RESERVE_LOW",
  ): Promise<{ sentAt: Date } | null> {
    const matches = this.notifications.filter(
      (n) => n.userId === userId && n.type === type,
    );
    if (matches.length === 0) return null;
    return { sentAt: matches[matches.length - 1]!.sentAt };
  }

  async insertProtectionPlan(plan: NewProtectionPlanRow): Promise<void> {
    this.shadowPlans.push(plan);
  }

  async getLatestRiskAssessment(
    _chainId: number,
    _asset: string,
  ): Promise<{ id: string; regime: Regime; validUntil: Date; drivers?: any } | null> {
    return this.latestRiskAssessment;
  }

  async getSpent24h(positionKey: string, since: Date): Promise<bigint> {
    let sum = 0n;
    for (const p of this.shadowPlans) {
      if (
        p.positionKey === positionKey &&
        p.decision === "ACCEPTED" &&
        p.createdAt &&
        new Date(p.createdAt).getTime() >= since.getTime() &&
        p.amount
      ) {
        sum += BigInt(p.amount);
      }
    }
    return sum;
  }
}

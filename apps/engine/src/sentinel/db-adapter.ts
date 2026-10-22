import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@tahansoe/db";
import {
  users,
  policies,
  positions,
  eventCursors,
  notificationLogs,
  telegramAccounts,
} from "@tahansoe/db";
import type { Address, RiskZone } from "@tahansoe/domain";
import type { EventSyncDatabase } from "./event-sync.ts";
import type { PolicyRecord } from "./types.ts";

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
  }): Promise<string>;
  linkPolicyPosition(policyId: string, positionId: string): Promise<void>;
  getLastNotification(
    userId: string,
    type: "HF_WARNING" | "HF_CRITICAL" | "RESERVE_LOW",
  ): Promise<{ sentAt: Date } | null>;
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
    debtAsset: Address;
    maxRepayPerAction: bigint;
    triggerThreshold: number;
    targetHealthFactor: number;
  }): Promise<void> {
    const gAddr = data.guardianAddress.toLowerCase();
    const dAsset = data.debtAsset.toLowerCase();

    await this.db
      .insert(policies)
      .values({
        userId: data.userId,
        chainId: data.chainId,
        guardianAddress: gAddr,
        guardianVersion: data.guardianVersion,
        debtAsset: dAsset,
        maxRepayPerAction: data.maxRepayPerAction.toString(),
        triggerThreshold: data.triggerThreshold.toFixed(4),
        targetHealthFactor: data.targetHealthFactor.toFixed(4),
        isActive: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [policies.userId, policies.guardianAddress],
        set: {
          isActive: true,
          guardianVersion: data.guardianVersion,
          debtAsset: dAsset,
          maxRepayPerAction: data.maxRepayPerAction.toString(),
          triggerThreshold: data.triggerThreshold.toFixed(4),
          targetHealthFactor: data.targetHealthFactor.toFixed(4),
          updatedAt: new Date(),
        },
      });
  }

  async disablePolicy(userId: string, guardianAddress: Address): Promise<void> {
    await this.db
      .update(policies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(policies.userId, userId),
          eq(policies.guardianAddress, guardianAddress.toLowerCase()),
        ),
      );
  }

  async updateLayer2(data: {
    userId: string;
    guardianAddress: Address;
    kind: number;
    source: Address;
    maxAssets: bigint;
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
        ),
      );
  }

  async updateTriggerBand(data: {
    userId: string;
    guardianAddress: Address;
    minTriggerHf: number;
    maxTriggerHf: number;
    riskAgent: Address;
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
        ),
      );
  }

  async updateDynamicTrigger(data: {
    userId: string;
    guardianAddress: Address;
    dynamicTriggerHf: number;
    validUntil: Date;
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

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userAddress: r.walletAddress as Address,
      chainId: r.chainId,
      guardianAddress: (r.guardianAddress ?? "") as Address,
      guardianVersion: r.guardianVersion ?? 1,
      debtAsset: (r.debtAsset ?? "") as Address,
      maxRepayPerAction: r.maxRepayPerAction ? BigInt(r.maxRepayPerAction) : 0n,
      triggerThreshold: Number(r.triggerThreshold ?? "1.30"),
      targetHealthFactor: Number(r.targetHealthFactor ?? "1.60"),
      isActive: r.isActive,
      minTriggerHf: r.minTriggerHf ? Number(r.minTriggerHf) : null,
      maxTriggerHf: r.maxTriggerHf ? Number(r.maxTriggerHf) : null,
      riskAgent: (r.riskAgent as Address) ?? null,
      dynamicTriggerHf: r.dynamicTriggerHf ? Number(r.dynamicTriggerHf) : null,
      dynamicValidUntil: r.dynamicValidUntil ?? null,
    }));
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
    debtAsset: Address;
    maxRepayPerAction: bigint;
    triggerThreshold: number;
    targetHealthFactor: number;
  }): Promise<void> {
    const key = `${data.userId}:${data.guardianAddress.toLowerCase()}`;
    const user = Array.from(this.users.values()).find((u) => u.id === data.userId);
    const existing = this.policies.get(key);

    this.policies.set(key, {
      id: existing?.id ?? `policy-${this.nextId++}`,
      userId: data.userId,
      userAddress: (user?.walletAddress ?? "") as Address,
      chainId: data.chainId,
      guardianAddress: data.guardianAddress.toLowerCase() as Address,
      guardianVersion: data.guardianVersion,
      debtAsset: data.debtAsset.toLowerCase() as Address,
      maxRepayPerAction: data.maxRepayPerAction,
      triggerThreshold: data.triggerThreshold,
      targetHealthFactor: data.targetHealthFactor,
      isActive: true,
      minTriggerHf: existing?.minTriggerHf ?? null,
      maxTriggerHf: existing?.maxTriggerHf ?? null,
      riskAgent: existing?.riskAgent ?? null,
      dynamicTriggerHf: existing?.dynamicTriggerHf ?? null,
      dynamicValidUntil: existing?.dynamicValidUntil ?? null,
    });
  }

  async disablePolicy(userId: string, guardianAddress: Address): Promise<void> {
    const key = `${userId}:${guardianAddress.toLowerCase()}`;
    const policy = this.policies.get(key);
    if (policy) {
      policy.isActive = false;
    }
  }

  async updateLayer2(data: {
    userId: string;
    guardianAddress: Address;
    kind: number;
    source: Address;
    maxAssets: bigint;
  }): Promise<void> {
    const key = `${data.userId}:${data.guardianAddress.toLowerCase()}`;
    const policy = this.policies.get(key);
    if (policy) {
      (policy as any).layer2Kind = data.kind;
      (policy as any).layer2Source = data.source.toLowerCase();
      (policy as any).layer2MaxAssets = data.maxAssets;
    }
  }

  async updateLayer3(data: {
    userId: string;
    guardianAddress: Address;
    enabled: boolean;
    collateralAsset: Address;
    maxCollateral: bigint;
    maxSlippageBps: number;
  }): Promise<void> {
    const key = `${data.userId}:${data.guardianAddress.toLowerCase()}`;
    const policy = this.policies.get(key);
    if (policy) {
      (policy as any).layer3Enabled = data.enabled;
      (policy as any).layer3CollateralAsset = data.collateralAsset.toLowerCase();
      (policy as any).layer3MaxCollateral = data.maxCollateral;
      (policy as any).layer3MaxSlippageBps = data.maxSlippageBps;
    }
  }

  async updateTriggerBand(data: {
    userId: string;
    guardianAddress: Address;
    minTriggerHf: number;
    maxTriggerHf: number;
    riskAgent: Address;
  }): Promise<void> {
    const key = `${data.userId}:${data.guardianAddress.toLowerCase()}`;
    const policy = this.policies.get(key);
    if (policy) {
      policy.minTriggerHf = data.minTriggerHf;
      policy.maxTriggerHf = data.maxTriggerHf;
      policy.riskAgent = data.riskAgent.toLowerCase() as Address;
    }
  }

  async updateDynamicTrigger(data: {
    userId: string;
    guardianAddress: Address;
    dynamicTriggerHf: number;
    validUntil: Date;
  }): Promise<void> {
    const key = `${data.userId}:${data.guardianAddress.toLowerCase()}`;
    const policy = this.policies.get(key);
    if (policy) {
      policy.dynamicTriggerHf = data.dynamicTriggerHf;
      policy.dynamicValidUntil = data.validUntil;
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
    return Array.from(this.policies.values()).filter(
      (p) => p.chainId === chainId && p.isActive,
    );
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
  }): Promise<string> {
    const key = `${data.userId}:${data.protocol}:${data.chainId}`;
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
}

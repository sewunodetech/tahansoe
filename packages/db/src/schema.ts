import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const protocolEnum = pgEnum("protocol", ["aave-v3", "morpho-blue"]);

export const intentActionEnum = pgEnum("intent_action", [
  "REPAY",
  "SUPPLY_COLLATERAL",
  "DELEVERAGE",
  "NOOP",
]);

export const fundingSourceEnum = pgEnum("funding_source", [
  "HOT_RESERVE",
  "WARM_RESERVE",
  "FLASH_LOAN",
]);

export const intentStatusEnum = pgEnum("intent_status", [
  "PENDING",
  "SIMULATED",
  "EXECUTED",
  "FAILED",
  "SKIPPED",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "HF_WARNING",
  "HF_CRITICAL",
  "EXECUTION_SUCCESS",
  "EXECUTION_FAILED",
  "LINK_CONFIRMED",
  "RESERVE_LOW",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    chainId: integer("chain_id").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    walletChainUnique: uniqueIndex("users_wallet_chain_unique").on(
      t.walletAddress,
      t.chainId
    ),
  })
);

export const siweNonces = pgTable(
  "siwe_nonces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nonce: text("nonce").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nonceUnique: uniqueIndex("siwe_nonces_nonce_unique").on(t.nonce),
  })
);

export const linkNonces = pgTable(
  "link_nonces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    codeUnique: uniqueIndex("link_nonces_code_unique").on(t.code),
  })
);

export const telegramAccounts = pgTable(
  "telegram_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull(),
    telegramUsername: text("telegram_username"),
    isActive: boolean("is_active").notNull().default(true),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    telegramUserUnique: uniqueIndex("telegram_accounts_tguser_unique").on(
      t.telegramUserId
    ),
    userIdx: index("telegram_accounts_user_idx").on(t.userId),
  })
);

export const guardianModules = pgTable(
  "guardian_modules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    safeAddress: text("safe_address").notNull(),
    moduleAddress: text("module_address").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userChainUnique: uniqueIndex("guardian_modules_user_chain_unique").on(
      t.userId,
      t.chainId
    ),
  })
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    protocol: protocolEnum("protocol").notNull(),
    chainId: integer("chain_id").notNull(),
    marketId: text("market_id"),
    healthFactor: numeric("health_factor", { precision: 38, scale: 18 }).notNull(),
    liquidationThreshold: numeric("liquidation_threshold", {
      precision: 38,
      scale: 18,
    }).notNull(),
    collateralValueUsd: numeric("collateral_value_usd", {
      precision: 38,
      scale: 18,
    }).notNull(),
    debtValueUsd: numeric("debt_value_usd", { precision: 38, scale: 18 }).notNull(),
    oracleSource: text("oracle_source").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("positions_user_idx").on(t.userId),
    protocolMarketIdx: index("positions_protocol_market_idx").on(
      t.protocol,
      t.marketId
    ),
  })
);

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    positionId: uuid("position_id").references(() => positions.id, {
      onDelete: "cascade",
    }),
    positionKey: text("position_key"),
    chainId: integer("chain_id").notNull().default(421614),
    guardianAddress: text("guardian_address"),
    guardianVersion: integer("guardian_version"),
    debtAsset: text("debt_asset"),
    maxRepayPerAction: numeric("max_repay_per_action", { precision: 38, scale: 0 }),
    layer2Kind: integer("layer2_kind"),
    layer2Source: text("layer2_source"),
    layer2MaxAssets: numeric("layer2_max_assets", { precision: 38, scale: 0 }),
    layer3Enabled: boolean("layer3_enabled").notNull().default(false),
    layer3CollateralAsset: text("layer3_collateral_asset"),
    layer3MaxCollateral: numeric("layer3_max_collateral", { precision: 38, scale: 0 }),
    layer3MaxSlippageBps: integer("layer3_max_slippage_bps"),
    minTriggerHf: numeric("min_trigger_hf", { precision: 10, scale: 4 }),
    maxTriggerHf: numeric("max_trigger_hf", { precision: 10, scale: 4 }),
    riskAgent: text("risk_agent"),
    dynamicTriggerHf: numeric("dynamic_trigger_hf", { precision: 10, scale: 4 }),
    dynamicValidUntil: timestamp("dynamic_valid_until", { withTimezone: true }),
    triggerThreshold: numeric("trigger_threshold", { precision: 10, scale: 4 })
      .notNull()
      .default("1.30"),
    targetHealthFactor: numeric("target_health_factor", {
      precision: 10,
      scale: 4,
    })
      .notNull()
      .default("1.60"),
    fundingSourcePriority: jsonb("funding_source_priority")
      .$type<("HOT_RESERVE" | "WARM_RESERVE" | "FLASH_LOAN")[]>()
      .notNull()
      .default(["HOT_RESERVE", "WARM_RESERVE", "FLASH_LOAN"]),
    sourcePrompt: text("source_prompt"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("policies_user_idx").on(t.userId),
    // Guardian klasik v1–v3: satu policy per user per Guardian (position_key NULL).
    userGuardianClassicUnique: uniqueIndex("policies_user_guardian_classic_unique")
      .on(t.userId, t.guardianAddress)
      .where(sql`${t.positionKey} IS NULL`),
    // Guardian per posisi (v4, Morpho): satu policy per posisi (ADR 0015).
    userGuardianPositionUnique: uniqueIndex("policies_user_guardian_position_unique")
      .on(t.userId, t.guardianAddress, t.positionKey)
      .where(sql`${t.positionKey} IS NOT NULL`),
    chainActiveIdx: index("policies_chain_active_idx").on(t.chainId, t.isActive),
    positionKeyIdx: index("policies_position_key_idx").on(t.positionKey),
  })
);

export const eventCursors = pgTable(
  "event_cursors",
  {
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    contractAddress: text("contract_address").notNull(),
    cursorName: text("cursor_name").notNull().default("events"),
    lastBlockNumber: bigint("last_block_number", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    chainContractCursorIdx: uniqueIndex("event_cursors_key_unique").on(
      t.chainId,
      t.contractAddress,
      t.cursorName
    ),
  })
);

export const intents = pgTable(
  "intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    positionKey: text("position_key"),
    action: intentActionEnum("action").notNull(),
    amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
    asset: text("asset").notNull(),
    source: fundingSourceEnum("source").notNull(),
    targetHealthFactor: numeric("target_health_factor", {
      precision: 10,
      scale: 4,
    }).notNull(),
    reason: text("reason").notNull(),
    estimatedGas: numeric("estimated_gas", { precision: 38, scale: 0 }),
    estimatedSlippageBps: integer("estimated_slippage_bps"),
    feeAmount: numeric("fee_amount", { precision: 38, scale: 18 }),
    feeWaived: numeric("fee_waived", { precision: 38, scale: 18 }),
    status: intentStatusEnum("status").notNull().default("PENDING"),
    txHash: text("tx_hash"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("intents_user_idx").on(t.userId),
    positionIdx: index("intents_position_idx").on(t.positionId),
    statusIdx: index("intents_status_idx").on(t.status),
  })
);

export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramAccountId: uuid("telegram_account_id").references(
      () => telegramAccounts.id,
      { onDelete: "set null" }
    ),
    intentId: uuid("intent_id").references(() => intents.id, {
      onDelete: "set null",
    }),
    type: notificationTypeEnum("type").notNull(),
    message: text("message").notNull(),
    deliveredOk: boolean("delivered_ok").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("notification_logs_user_idx").on(t.userId),
  })
);


export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    message: text("message").notNull(),
    recipientsCount: integer("recipients_count").notNull(),
    sentCount: integer("sent_count").notNull(),
    failedCount: integer("failed_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupeKeyUnique: uniqueIndex("broadcasts_dedupe_key_unique").on(t.dedupeKey),
  })
);

export type Broadcast = typeof broadcasts.$inferSelect;
export type NewBroadcast = typeof broadcasts.$inferInsert;

export const simSessions = pgTable(
  "sim_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    address: text("address").notNull(),
    mode: text("mode").notNull(),
    scenario: text("scenario"),
    forkId: text("fork_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    positionOpenedAt: timestamp("position_opened_at", { withTimezone: true }),
    firstProtectAt: timestamp("first_protect_at", { withTimezone: true }),
    layersUsed: integer("layers_used").array(),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    userAgentHash: text("user_agent_hash"),
  },
  (t) => ({
    createdAtIdx: index("sim_sessions_created_at_idx").on(t.createdAt),
  })
);

export type SimSession = typeof simSessions.$inferSelect;
export type NewSimSession = typeof simSessions.$inferInsert;

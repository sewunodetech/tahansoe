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
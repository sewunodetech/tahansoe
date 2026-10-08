import "./env";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function migrate() {
  console.log("Running migrations...\n");

  async function createTypeIfNotExists(name: string, values: string) {
    const exists = await sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = ${name}
      ) AS exists;
    `;
    const [row] = exists as [{ exists: boolean }];
    if (!row.exists) {
      await sql.unsafe(`CREATE TYPE ${name} AS ENUM (${values})`);
      console.log(`  Type ${name} created.`);
    } else {
      console.log(`  Type ${name} already exists.`);
    }
  }

  await createTypeIfNotExists("protocol", "'aave-v3', 'morpho-blue'");
  await createTypeIfNotExists("intent_action", "'REPAY', 'SUPPLY_COLLATERAL', 'DELEVERAGE', 'NOOP'");
  await createTypeIfNotExists("funding_source", "'HOT_RESERVE', 'WARM_RESERVE', 'FLASH_LOAN'");
  await createTypeIfNotExists("intent_status", "'PENDING', 'SIMULATED', 'EXECUTED', 'FAILED', 'SKIPPED'");
  await createTypeIfNotExists("notification_type", "'HF_WARNING', 'EXECUTION_SUCCESS', 'EXECUTION_FAILED', 'LINK_CONFIRMED', 'RESERVE_LOW'");

  console.log("Enums ready.\n");

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_chain_unique ON users (wallet_address, chain_id);
  `;
  console.log("  users");

  await sql`
    CREATE TABLE IF NOT EXISTS siwe_nonces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nonce TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS siwe_nonces_nonce_unique ON siwe_nonces (nonce);
  `;
  console.log("  siwe_nonces");

  await sql`
    CREATE TABLE IF NOT EXISTS link_nonces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS link_nonces_code_unique ON link_nonces (code);
  `;
  console.log("  link_nonces");

  await sql`
    CREATE TABLE IF NOT EXISTS telegram_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      telegram_user_id BIGINT NOT NULL,
      telegram_username TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS telegram_accounts_tguser_unique ON telegram_accounts (telegram_user_id);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS telegram_accounts_user_idx ON telegram_accounts (user_id);
  `;
  console.log("  telegram_accounts");

  await sql`
    CREATE TABLE IF NOT EXISTS guardian_modules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      chain_id INTEGER NOT NULL,
      safe_address TEXT NOT NULL,
      module_address TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS guardian_modules_user_chain_unique ON guardian_modules (user_id, chain_id);
  `;
  console.log("  guardian_modules");

  await sql`
    CREATE TABLE IF NOT EXISTS positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      protocol protocol NOT NULL,
      chain_id INTEGER NOT NULL,
      market_id TEXT,
      health_factor NUMERIC(38,18) NOT NULL,
      liquidation_threshold NUMERIC(38,18) NOT NULL,
      collateral_value_usd NUMERIC(38,18) NOT NULL,
      debt_value_usd NUMERIC(38,18) NOT NULL,
      oracle_source TEXT NOT NULL,
      last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS positions_user_idx ON positions (user_id);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS positions_protocol_market_idx ON positions (protocol, market_id);
  `;
  console.log("  positions");

  await sql`
    CREATE TABLE IF NOT EXISTS policies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      position_id UUID REFERENCES positions (id) ON DELETE CASCADE,
      trigger_threshold NUMERIC(10,4) NOT NULL DEFAULT 1.30,
      target_health_factor NUMERIC(10,4) NOT NULL DEFAULT 1.60,
      funding_source_priority JSONB NOT NULL DEFAULT '["HOT_RESERVE","WARM_RESERVE","FLASH_LOAN"]',
      source_prompt TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS policies_user_idx ON policies (user_id);
  `;
  console.log("  policies");

  await sql`
    CREATE TABLE IF NOT EXISTS intents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      position_id UUID NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
      action intent_action NOT NULL,
      amount NUMERIC(38,18) NOT NULL,
      asset TEXT NOT NULL,
      source funding_source NOT NULL,
      target_health_factor NUMERIC(10,4) NOT NULL,
      reason TEXT NOT NULL,
      estimated_gas NUMERIC(38,0),
      estimated_slippage_bps INTEGER,
      status intent_status NOT NULL DEFAULT 'PENDING',
      tx_hash TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      executed_at TIMESTAMPTZ
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS intents_user_idx ON intents (user_id);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS intents_position_idx ON intents (position_id);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS intents_status_idx ON intents (status);
  `;
  console.log("  intents");

  await sql`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      telegram_account_id UUID REFERENCES telegram_accounts (id) ON DELETE SET NULL,
      intent_id UUID REFERENCES intents (id) ON DELETE SET NULL,
      type notification_type NOT NULL,
      message TEXT NOT NULL,
      delivered_ok BOOLEAN NOT NULL DEFAULT false,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS notification_logs_user_idx ON notification_logs (user_id);
  `;
  console.log("  notification_logs");

  console.log("\nMigration complete.");
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
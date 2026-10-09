import "./env";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function reset() {
  console.log("Dropping all tables...");
  await sql`DROP TABLE IF EXISTS notification_logs CASCADE`;
  await sql`DROP TABLE IF EXISTS intents CASCADE`;
  await sql`DROP TABLE IF EXISTS policies CASCADE`;
  await sql`DROP TABLE IF EXISTS positions CASCADE`;
  await sql`DROP TABLE IF EXISTS guardian_modules CASCADE`;
  await sql`DROP TABLE IF EXISTS telegram_accounts CASCADE`;
  await sql`DROP TABLE IF EXISTS link_nonces CASCADE`;
  await sql`DROP TABLE IF EXISTS siwe_nonces CASCADE`;
  await sql`DROP TABLE IF EXISTS users CASCADE`;

  console.log("Dropping old enums...");
  await sql`DROP TYPE IF EXISTS notification_type CASCADE`;
  await sql`DROP TYPE IF EXISTS intent_status CASCADE`;
  await sql`DROP TYPE IF EXISTS funding_source CASCADE`;
  await sql`DROP TYPE IF EXISTS intent_action CASCADE`;
  await sql`DROP TYPE IF EXISTS protocol CASCADE`;

  console.log("Creating enums...");
  await sql`CREATE TYPE protocol AS ENUM ('aave-v3', 'morpho-blue')`;
  await sql`CREATE TYPE intent_action AS ENUM ('REPAY', 'SUPPLY_COLLATERAL', 'DELEVERAGE', 'NOOP')`;
  await sql`CREATE TYPE funding_source AS ENUM ('HOT_RESERVE', 'WARM_RESERVE', 'FLASH_LOAN')`;
  await sql`CREATE TYPE intent_status AS ENUM ('PENDING', 'SIMULATED', 'EXECUTED', 'FAILED', 'SKIPPED')`;
  await sql`CREATE TYPE notification_type AS ENUM ('HF_WARNING', 'EXECUTION_SUCCESS', 'EXECUTION_FAILED', 'LINK_CONFIRMED', 'RESERVE_LOW')`;

  console.log("Creating users...");
  await sql`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_chain_unique ON users (wallet_address, chain_id);`;

  console.log("Creating siwe_nonces...");
  await sql`
    CREATE TABLE siwe_nonces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nonce TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS siwe_nonces_nonce_unique ON siwe_nonces (nonce);`;

  console.log("Creating link_nonces...");
  await sql`
    CREATE TABLE link_nonces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS link_nonces_code_unique ON link_nonces (code);`;

  console.log("Creating telegram_accounts...");
  await sql`
    CREATE TABLE telegram_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      telegram_user_id BIGINT NOT NULL,
      telegram_username TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS telegram_accounts_tguser_unique ON telegram_accounts (telegram_user_id);`;
  await sql`CREATE INDEX IF NOT EXISTS telegram_accounts_user_idx ON telegram_accounts (user_id);`;

  console.log("Creating guardian_modules...");
  await sql`
    CREATE TABLE guardian_modules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      chain_id INTEGER NOT NULL,
      safe_address TEXT NOT NULL,
      module_address TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS guardian_modules_user_chain_unique ON guardian_modules (user_id, chain_id);`;

  console.log("Creating positions...");
  await sql`
    CREATE TABLE positions (
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
  await sql`CREATE INDEX IF NOT EXISTS positions_user_idx ON positions (user_id);`;
  await sql`CREATE INDEX IF NOT EXISTS positions_protocol_market_idx ON positions (protocol, market_id);`;

  console.log("Creating policies...");
  await sql`
    CREATE TABLE policies (
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
  await sql`CREATE INDEX IF NOT EXISTS policies_user_idx ON policies (user_id);`;

  console.log("Creating intents...");
  await sql`
    CREATE TABLE intents (
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
  await sql`CREATE INDEX IF NOT EXISTS intents_user_idx ON intents (user_id);`;
  await sql`CREATE INDEX IF NOT EXISTS intents_position_idx ON intents (position_id);`;
  await sql`CREATE INDEX IF NOT EXISTS intents_status_idx ON intents (status);`;

  console.log("Creating notification_logs...");
  await sql`
    CREATE TABLE notification_logs (
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
  await sql`CREATE INDEX IF NOT EXISTS notification_logs_user_idx ON notification_logs (user_id);`;

  console.log("\nAll tables reset successfully.");
}

reset()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Reset failed:", err); process.exit(1); });
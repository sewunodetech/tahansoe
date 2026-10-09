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
      // Catatan: `sql.unsafe(...)` pada @neondatabase/serverless (HTTP) TIDAK
      // mengeksekusi DDL ini secara andal (type tidak persist). Pakai `sql.query`.
      await sql.query(`CREATE TYPE ${name} AS ENUM (${values})`);
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

  // --- Research layer (ADR 0004/0005): signals, research_reports, settlements, lessons.
  await createTypeIfNotExists(
    "signal_module",
    "'ORACLE', 'TECHNICAL', 'ONCHAIN', 'MACRO', 'NEWS', 'SOCIAL', 'RESEARCH'",
  );
  await createTypeIfNotExists("research_trigger", "'SCHEDULED', 'ESCALATION'");
  await createTypeIfNotExists(
    "settlement_label",
    "'TRUE_POSITIVE', 'FALSE_POSITIVE', 'MISSED', 'TRUE_NEGATIVE'",
  );
  await createTypeIfNotExists("price_source", "'aave_oracle', 'chainlink_proxy'");

  await sql`
    CREATE TABLE IF NOT EXISTS signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chain_id INTEGER NOT NULL,
      module signal_module NOT NULL,
      paths JSONB,
      assets JSONB NOT NULL,
      direction TEXT NOT NULL,
      severity NUMERIC(5,4) NOT NULL,
      confidence NUMERIC(5,4) NOT NULL,
      horizon_hours INTEGER NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      evidence JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS signals_module_idx ON signals (module);`;
  await sql`CREATE INDEX IF NOT EXISTS signals_expires_idx ON signals (expires_at);`;
  await sql`CREATE INDEX IF NOT EXISTS signals_chain_idx ON signals (chain_id);`;
  console.log("  signals");

  await sql`
    CREATE TABLE IF NOT EXISTS research_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chain_id INTEGER NOT NULL,
      trigger research_trigger NOT NULL,
      report JSONB NOT NULL,
      analyst_reports JSONB NOT NULL,
      debate JSONB NOT NULL,
      prompt_version TEXT NOT NULL,
      models JSONB NOT NULL,
      usage JSONB NOT NULL,
      diagnostics JSONB,
      horizon_ends_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS research_reports_horizon_idx ON research_reports (horizon_ends_at);`;
  await sql`CREATE INDEX IF NOT EXISTS research_reports_chain_idx ON research_reports (chain_id);`;
  console.log("  research_reports");

  await sql`
    CREATE TABLE IF NOT EXISTS risk_settlements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chain_id INTEGER NOT NULL,
      risk_assessment_id UUID,
      research_report_id UUID REFERENCES research_reports (id) ON DELETE CASCADE,
      label settlement_label NOT NULL,
      lead_time_minutes INTEGER,
      outcome JSONB NOT NULL,
      model_version TEXT NOT NULL,
      settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS risk_settlements_label_idx ON risk_settlements (label);`;
  await sql`CREATE INDEX IF NOT EXISTS risk_settlements_report_idx ON risk_settlements (research_report_id);`;
  console.log("  risk_settlements");

  await sql`
    CREATE TABLE IF NOT EXISTS research_lessons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      settlement_id UUID NOT NULL REFERENCES risk_settlements (id) ON DELETE CASCADE,
      paths JSONB NOT NULL,
      lesson TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS research_lessons_active_idx ON research_lessons (active);`;
  console.log("  research_lessons");

  await sql`
    CREATE TABLE IF NOT EXISTS price_samples (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chain_id INTEGER NOT NULL,
      asset TEXT NOT NULL,
      source price_source NOT NULL,
      price_usd NUMERIC(24,8) NOT NULL,
      block_number BIGINT NOT NULL,
      sampled_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS price_samples_chain_asset_sampled_idx ON price_samples (chain_id, asset, sampled_at);`;
  console.log("  price_samples");

  // --- Risk Fusion v1 (spec m2-risk-fusion-v1 §3.7): risk_assessments.
  await createTypeIfNotExists("regime", "'CALM', 'ELEVATED', 'STRESSED', 'CRISIS'");

  await sql`
    CREATE TABLE IF NOT EXISTS risk_assessments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      chain_id INTEGER NOT NULL,
      asset TEXT NOT NULL,
      regime regime NOT NULL,
      risk_score NUMERIC(5,2) NOT NULL,
      drawdown_h4 NUMERIC(6,5) NOT NULL,
      drawdown_h24 NUMERIC(6,5) NOT NULL,
      recommended_trigger_hf NUMERIC(6,4) NOT NULL,
      recommended_target_hf NUMERIC(6,4) NOT NULL,
      drivers JSONB NOT NULL,
      reasons JSONB NOT NULL,
      explanation TEXT NOT NULL,
      model_version TEXT NOT NULL,
      valid_until TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS risk_assessments_chain_asset_idx ON risk_assessments (chain_id, asset);`;
  await sql`CREATE INDEX IF NOT EXISTS risk_assessments_valid_until_idx ON risk_assessments (valid_until);`;
  await sql`CREATE INDEX IF NOT EXISTS risk_assessments_created_at_idx ON risk_assessments (created_at);`;
  console.log("  risk_assessments");

  console.log("\nMigration complete.");
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
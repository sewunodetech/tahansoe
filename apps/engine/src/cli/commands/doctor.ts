/**
 * `tahansoe doctor` — cek kesehatan konfigurasi (spec §3.1, §4).
 *
 * Memeriksa: LLM_API_URL + LLM_API_KEY ada (host disamarkan, key TIDAK dicetak),
 * GET {url}/models bisa dijangkau, DATABASE_URL terhubung, ARBITRUM_RPC_URL
 * eth_chainId=42161, FRED key ada, settings.json valid. Output ✔/✖.
 */

import { parseArgs } from "node:util";
import { detectTheme, maskHost, sanitizeExternal, type Theme } from "../render.ts";
import { gatewayConfig } from "../../llm/registry.ts";
import { EXIT_OK, EXIT_ERROR, EXIT_CONFIG } from "./args.ts";

export const DOCTOR_HELP = `tahansoe doctor — check environment & connectivity

Usage: tahansoe doctor [--json] [--no-color]`;

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Fetch minimal injectable untuk test. */
export type DoctorFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface DoctorDeps {
  fetchImpl?: DoctorFetch;
  /** Pengecek DB (default: coba import @tahansoe/db + query ringan). */
  checkDb?: () => Promise<{ ok: boolean; detail: string }>;
  env?: NodeJS.ProcessEnv;
  /** Pembaca settings (default: loadSettings). */
  loadSettingsImpl?: () => Promise<{ ok: boolean; detail: string }>;
  /** Writer injectable (test); default process.stdout/stderr. */
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

const TIMEOUT_MS = 8000;
/** Gateway /models bisa lambat (mis. Bynara ~12s) → timeout lebih longgar. */
const MODELS_TIMEOUT_MS = 25_000;

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs = TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    return await fn(ctrl.signal);
  } catch (err) {
    if (timedOut) throw new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Jalankan semua pengecekan (pure terhadap deps). Mengembalikan daftar hasil. */
export async function runDoctor(deps: DoctorDeps = {}): Promise<CheckResult[]> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as DoctorFetch);
  const results: CheckResult[] = [];

  const g = gatewayConfig();
  const apiUrl = g.baseURL;
  const apiKey = g.apiKey;

  // 1. LLM_API_URL ada.
  results.push({
    name: "LLM_API_URL",
    ok: apiUrl.length > 0,
    detail: apiUrl ? maskHost(apiUrl) : "belum diisi",
  });
  // 2. LLM_API_KEY ada (JANGAN cetak nilai).
  results.push({
    name: "LLM_API_KEY",
    ok: apiKey.length > 0,
    detail: apiKey.length > 0 ? "set (hidden)" : "belum diisi",
  });

  // 3. GET {url}/models reachable (hanya bila url ada).
  if (apiUrl) {
    try {
      const r = await withTimeout((signal) => {
        const headers: Record<string, string> = { accept: "application/json" };
        if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
        return fetchImpl(`${apiUrl}/models`, { method: "GET", headers, signal });
      }, MODELS_TIMEOUT_MS);
      results.push({
        name: "gateway /models",
        ok: r.ok,
        detail: r.ok ? `HTTP ${r.status} @ ${maskHost(apiUrl)}` : `HTTP ${r.status}`,
      });
    } catch (err) {
      results.push({ name: "gateway /models", ok: false, detail: sanitizeExternal(err instanceof Error ? err.message : String(err), 80) });
    }
  } else {
    results.push({ name: "gateway /models", ok: false, detail: "lewati (LLM_API_URL kosong)" });
  }

  // 4. DATABASE_URL connect.
  if (env.DATABASE_URL) {
    const check = deps.checkDb ?? defaultCheckDb;
    try {
      const r = await check();
      results.push({ name: "DATABASE_URL", ok: r.ok, detail: r.detail });
    } catch (err) {
      results.push({ name: "DATABASE_URL", ok: false, detail: sanitizeExternal(err instanceof Error ? err.message : String(err), 80) });
    }
  } else {
    results.push({ name: "DATABASE_URL", ok: false, detail: "belum diisi" });
  }

  // 5. ARBITRUM_RPC_URL eth_chainId = 42161.
  const rpc = env.ARBITRUM_RPC_URL?.trim();
  if (rpc) {
    try {
      const r = await withTimeout((signal) =>
        fetchImpl(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
          signal,
        }),
      );
      const payload = (await r.json()) as { result?: string };
      const chainId = payload.result ? parseInt(payload.result, 16) : NaN;
      results.push({
        name: "ARBITRUM_RPC_URL",
        ok: chainId === 42161,
        detail: chainId === 42161 ? `chainId 42161 @ ${maskHost(rpc)}` : `chainId ${Number.isNaN(chainId) ? "?" : chainId} (butuh 42161)`,
      });
    } catch (err) {
      results.push({ name: "ARBITRUM_RPC_URL", ok: false, detail: sanitizeExternal(err instanceof Error ? err.message : String(err), 80) });
    }
  } else {
    results.push({ name: "ARBITRUM_RPC_URL", ok: true, detail: "kosong → pakai RPC publik (ok)" });
  }

  // 6. FRED key ada (opsional).
  results.push({
    name: "FRED_API_KEY",
    ok: Boolean(env.FRED_API_KEY?.trim()),
    detail: env.FRED_API_KEY?.trim() ? "set (hidden)" : "kosong → FRED dilewati",
  });

  // 7. settings.json valid.
  const loadS = deps.loadSettingsImpl ?? defaultCheckSettings;
  try {
    const r = await loadS();
    results.push({ name: "settings.json", ok: r.ok, detail: r.detail });
  } catch (err) {
    results.push({ name: "settings.json", ok: false, detail: sanitizeExternal(err instanceof Error ? err.message : String(err), 80) });
  }

  return results;
}

async function defaultCheckDb(): Promise<{ ok: boolean; detail: string }> {
  const { getDb } = await import("@tahansoe/db");
  const { sql } = await import("drizzle-orm");
  const db = getDb();
  await db.execute(sql`select 1`);
  return { ok: true, detail: "connected" };
}

async function defaultCheckSettings(): Promise<{ ok: boolean; detail: string }> {
  const { loadSettings } = await import("../../settings/settings.ts");
  const { settings, exists } = await loadSettings();
  if (!exists) return { ok: true, detail: "belum ada (pakai default)" };
  return { ok: true, detail: `v${settings.version} valid` };
}

/** Render daftar ✔/✖ (ASCII fallback bila no-color). */
export function formatDoctor(theme: Theme, results: CheckResult[]): string {
  const pcMod = theme.color;
  const lines = results.map((r) => {
    const mark = r.ok ? (pcMod ? "\x1b[32m✔\x1b[0m" : "✔") : pcMod ? "\x1b[31m✖\x1b[0m" : "✖";
    return `  ${mark} ${r.name.padEnd(18)} ${r.detail}`;
  });
  return lines.join("\n");
}

export async function doctorCommand(argv: string[], deps: DoctorDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { json: { type: "boolean" }, "no-color": { type: "boolean" }, help: { type: "boolean" } },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    writeOut(DOCTOR_HELP + "\n");
    return EXIT_OK;
  }

  const results = await runDoctor(deps);
  if (parsed.values.json) {
    writeOut(JSON.stringify(results) + "\n");
  } else {
    const theme = detectTheme(argv, process.env, process.stdout);
    writeOut(formatDoctor(theme, results) + "\n");
  }

  // Exit code: 2 (config) bila LLM_API_URL/KEY hilang; 1 bila ada check lain gagal; 0 ok.
  const gatewayMissing = results.some((r) => (r.name === "LLM_API_URL" || r.name === "LLM_API_KEY") && !r.ok);
  if (gatewayMissing) return EXIT_CONFIG;
  const anyFail = results.some((r) => !r.ok);
  return anyFail ? EXIT_ERROR : EXIT_OK;
}

/**
 * Mode background `tahansoe start --detach` + `stop` / `status` / `logs` (ADR 0011).
 *
 * - `start --detach` men-spawn proses `tahansoe start` terpisah (detached, tanpa
 *   terminal), stdout/stderr ke `apps/engine/.data/logs/tahansoe.log`.
 * - Proses daemon menulis pid file `apps/engine/.data/tahansoe.pid` dan memantau
 *   file permintaan berhenti `tahansoe.stop`. `tahansoe stop` menulis file itu agar
 *   shutdown tetap bersih di Windows (di sana SIGTERM = terminate paksa), lalu
 *   force-kill bila proses tidak keluar dalam batas waktu.
 *
 * Tanpa secret: pid file & log tidak memuat env; log hanya output proses `start`.
 * Untuk produksi/VPS tetap disarankan supervisor proses (systemd/pm2/Docker).
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EXIT_OK, EXIT_ERROR } from "./args.ts";

/** Env penanda bahwa proses `start` berjalan sebagai daemon. */
export const DAEMON_ENV = "TAHANSOE_DAEMON";
/** Batas ukuran log sebelum dirotasi saat daemon start (10 MB). */
const LOG_ROTATE_BYTES = 10 * 1024 * 1024;

export interface DaemonPaths {
  dataDir: string;
  pidFile: string;
  stopFile: string;
  logDir: string;
  logFile: string;
}

/** Lokasi file daemon. Default `apps/engine/.data`; override `TAHANSOE_DATA_DIR` (test). */
export function daemonPaths(env: NodeJS.ProcessEnv = process.env): DaemonPaths {
  const here = dirname(fileURLToPath(import.meta.url)); // src/cli/commands
  const dataDir = env.TAHANSOE_DATA_DIR?.trim() || join(here, "..", "..", "..", ".data");
  const logDir = join(dataDir, "logs");
  return {
    dataDir,
    pidFile: join(dataDir, "tahansoe.pid"),
    stopFile: join(dataDir, "tahansoe.stop"),
    logDir,
    logFile: join(logDir, "tahansoe.log"),
  };
}

export interface PidRecord {
  pid: number;
  startedAt: string;
  args: string[];
  logFile: string;
}

export function readPidRecord(paths: DaemonPaths): PidRecord | null {
  try {
    const rec = JSON.parse(readFileSync(paths.pidFile, "utf8")) as PidRecord;
    return typeof rec.pid === "number" ? rec : null;
  } catch {
    return null;
  }
}

/** True bila proses dengan pid itu masih hidup (EPERM = hidup, milik user lain). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Pid daemon yang sedang hidup, atau null (pid file basi dibersihkan). */
export function runningDaemon(paths: DaemonPaths): PidRecord | null {
  const rec = readPidRecord(paths);
  if (!rec) return null;
  if (isProcessAlive(rec.pid)) return rec;
  try {
    unlinkSync(paths.pidFile);
  } catch {
    /* abaikan */
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Dipanggil oleh proses `start` saat berjalan sebagai daemon: tulis pid file dan
 * pantau file stop. Mengembalikan AbortSignal untuk shutdown + fungsi cleanup.
 */
export function attachDaemonRuntime(
  argv: string[],
  paths: DaemonPaths = daemonPaths(),
  pollMs = 1000,
): { signal: AbortSignal; cleanup: () => void } {
  mkdirSync(paths.dataDir, { recursive: true });
  try {
    unlinkSync(paths.stopFile);
  } catch {
    /* tidak ada permintaan stop lama */
  }
  const rec: PidRecord = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    args: argv,
    logFile: paths.logFile,
  };
  writeFileSync(paths.pidFile, JSON.stringify(rec, null, 2));

  const ac = new AbortController();
  const timer = setInterval(() => {
    if (existsSync(paths.stopFile)) {
      clearInterval(timer);
      // Hapus file stop = tanda terima (handshake): `tahansoe stop` hanya boleh
      // force-kill pid yang terbukti daemon kita (lihat stopCommand).
      try {
        unlinkSync(paths.stopFile);
      } catch {
        /* abaikan */
      }
      process.stdout.write(`[daemon] stop requested at ${new Date().toISOString()}\n`);
      ac.abort();
    }
  }, pollMs); // sengaja ref'd: daemon tetap hidup sampai diminta berhenti.

  const cleanup = () => {
    clearInterval(timer);
    const cur = readPidRecord(paths);
    if (cur?.pid === process.pid) {
      try {
        unlinkSync(paths.pidFile);
      } catch {
        /* abaikan */
      }
    }
    try {
      unlinkSync(paths.stopFile);
    } catch {
      /* abaikan */
    }
  };
  process.once("exit", cleanup);
  return { signal: ac.signal, cleanup };
}

export interface DetachDeps {
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  paths?: DaemonPaths;
  /** Spawn injectable (test). Default: node child_process.spawn. */
  spawnImpl?: typeof spawn;
  /** Lama menunggu daemon menulis pid file (ms). */
  readyTimeoutMs?: number;
}

/**
 * `tahansoe start --detach`: spawn proses `start` (tanpa --detach) di background.
 * `startArgs` adalah argumen start lain yang diteruskan (mis. --no-broadcast).
 */
export async function startDetached(startArgs: string[], deps: DetachDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  const paths = deps.paths ?? daemonPaths(env);

  const existing = runningDaemon(paths);
  if (existing) {
    err(`tahansoe sudah berjalan di background (pid ${existing.pid}, sejak ${existing.startedAt}).\n`);
    err("Hentikan dulu dengan: tahansoe stop\n");
    return EXIT_ERROR;
  }

  mkdirSync(paths.logDir, { recursive: true });
  try {
    if (statSync(paths.logFile).size > LOG_ROTATE_BYTES) renameSync(paths.logFile, `${paths.logFile}.1`);
  } catch {
    /* log belum ada */
  }
  const fd = openSync(paths.logFile, "a");

  // Jalankan ulang entry CLI yang sama dengan loader yang sama (tsx ada di execArgv).
  const entry = process.argv[1]!;
  const args = [...process.execArgv, entry, "start", ...startArgs];
  const doSpawn = deps.spawnImpl ?? spawn;
  const child = doSpawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: { ...env, [DAEMON_ENV]: "1", NO_COLOR: "1" },
  });
  closeSync(fd);
  child.unref();

  // Tunggu daemon menulis pid file (tanda sudah melewati startup awal).
  const deadline = Date.now() + (deps.readyTimeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    const rec = readPidRecord(paths);
    if (rec && rec.pid === child.pid) {
      out(`✔ tahansoe berjalan di background (pid ${rec.pid}).\n`);
      out(`  log    : ${paths.logFile}\n`);
      out("  status : tahansoe status · logs: tahansoe logs -f · stop: tahansoe stop\n");
      return EXIT_OK;
    }
    if (child.exitCode !== null) break;
    await sleep(250);
  }
  err(`✖ daemon tidak siap (exit code ${child.exitCode ?? "?"}). Lihat log: ${paths.logFile}\n`);
  return EXIT_ERROR;
}

export interface StopDeps {
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  paths?: DaemonPaths;
  /** Batas tunggu shutdown bersih sebelum force kill (ms). */
  graceMs?: number;
  killImpl?: (pid: number, signal?: NodeJS.Signals | number) => void;
}

/** `tahansoe stop`: minta daemon berhenti bersih, force kill setelah batas waktu. */
export async function stopCommand(argv: string[], deps: StopDeps = {}): Promise<number> {
  const out = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  if (argv.includes("--help") || argv.includes("-h")) {
    out(
      "Usage: tahansoe stop [--force]\n\nStop the background agent started with 'tahansoe start --detach'.\n" +
        "--force kills the recorded pid immediately; only use it when you are sure the daemon is running.\n",
    );
    return EXIT_OK;
  }
  const paths = deps.paths ?? daemonPaths(deps.env);
  const rec = runningDaemon(paths);
  if (!rec) {
    out("tahansoe tidak sedang berjalan di background.\n");
    return EXIT_OK;
  }
  const kill = deps.killImpl ?? ((pid: number, sig?: NodeJS.Signals | number) => process.kill(pid, sig));
  const force = argv.includes("--force");

  if (!force) {
    writeFileSync(paths.stopFile, new Date().toISOString());
    out(`Menghentikan tahansoe (pid ${rec.pid})...\n`);
    const deadline = Date.now() + (deps.graceMs ?? 30_000);
    while (Date.now() < deadline) {
      if (!isProcessAlive(rec.pid)) {
        out("✔ berhenti dengan bersih.\n");
        return EXIT_OK;
      }
      await sleep(500);
    }
    // File stop tidak pernah diambil → pid itu bukan daemon kita (pid file basi
    // setelah crash/reboot dan pid dipakai ulang proses lain). JANGAN di-kill.
    if (existsSync(paths.stopFile)) {
      for (const f of [paths.pidFile, paths.stopFile]) {
        try {
          unlinkSync(f);
        } catch {
          /* abaikan */
        }
      }
      err(`pid ${rec.pid} tidak merespons permintaan stop — pid file dianggap basi dan dihapus (proses tidak di-kill).\n`);
      return EXIT_OK;
    }
    err("Daemon menerima stop tetapi tidak berhenti dalam batas waktu — force kill.\n");
  }
  try {
    kill(rec.pid, "SIGKILL");
  } catch (e) {
    err(`gagal menghentikan pid ${rec.pid}: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT_ERROR;
  }
  for (const f of [paths.pidFile, paths.stopFile]) {
    try {
      unlinkSync(f);
    } catch {
      /* abaikan */
    }
  }
  out("✔ dihentikan (force).\n");
  return EXIT_OK;
}

export interface StatusDeps {
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  paths?: DaemonPaths;
  /** Ringkasan run terakhir dari DB (injectable test). */
  lastRun?: () => Promise<string | null>;
}

async function defaultLastRun(): Promise<string | null> {
  if (!process.env.DATABASE_URL) return "DATABASE_URL belum diset";
  const { recentReports } = await import("../../db/history.ts");
  const rows = await recentReports(1);
  if (rows.length === 0) return "belum ada run tercatat";
  const r = rows[0]!;
  return `${r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · ${r.regime} ${r.direction}`;
}

function fmtUptime(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/** `tahansoe status`: daemon hidup/tidak + run riset terakhir. */
export async function statusCommand(argv: string[], deps: StatusDeps = {}): Promise<number> {
  const out = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  if (argv.includes("--help") || argv.includes("-h")) {
    out("Usage: tahansoe status [--json]\n\nShow whether the background agent is running and the latest research run.\n");
    return EXIT_OK;
  }
  const paths = deps.paths ?? daemonPaths(deps.env);
  const rec = runningDaemon(paths);
  let lastRun: string | null = null;
  try {
    lastRun = await (deps.lastRun ?? defaultLastRun)();
  } catch (e) {
    lastRun = `db tidak tersedia (${e instanceof Error ? e.message.slice(0, 80) : "error"})`;
  }

  if (argv.includes("--json")) {
    out(
      JSON.stringify({
        running: Boolean(rec),
        pid: rec?.pid ?? null,
        startedAt: rec?.startedAt ?? null,
        logFile: paths.logFile,
        lastRun,
      }) + "\n",
    );
    return EXIT_OK;
  }
  if (rec) {
    const up = fmtUptime(Date.now() - new Date(rec.startedAt).getTime());
    out(`agent    running · pid ${rec.pid} · up ${up}\n`);
    if (rec.args.length) out(`flags    ${rec.args.join(" ")}\n`);
  } else {
    out("agent    stopped (jalankan: tahansoe start --detach)\n");
  }
  out(`last run ${lastRun ?? "-"}\n`);
  out(`log      ${paths.logFile}\n`);
  return EXIT_OK;
}

export interface LogsDeps {
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  paths?: DaemonPaths;
  /** Hentikan mode follow (test). */
  followSignal?: AbortSignal;
}

/** `tahansoe logs [-n N] [-f]`: tampilkan ekor log daemon, opsional follow. */
export async function logsCommand(argv: string[], deps: LogsDeps = {}): Promise<number> {
  const out = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        follow: { type: "boolean", short: "f" },
        lines: { type: "string", short: "n" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: false,
    });
  } catch (e) {
    err(`argumen tidak valid: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    out("Usage: tahansoe logs [-n <lines>] [-f]\n\nShow the background agent log (default last 50 lines).\n");
    return EXIT_OK;
  }
  const paths = deps.paths ?? daemonPaths(deps.env);
  const n = Math.max(1, Number.parseInt(parsed.values.lines ?? "50", 10) || 50);

  let content: string;
  try {
    content = readFileSync(paths.logFile, "utf8");
  } catch {
    out(`Belum ada log (${paths.logFile}).\n`);
    return EXIT_OK;
  }
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  out(lines.slice(-n).join("\n") + (lines.length ? "\n" : ""));
  if (!parsed.values.follow) return EXIT_OK;

  // Follow: polling ukuran file (portabel di Windows), cetak byte baru saja.
  let offset = Buffer.byteLength(content);
  const signal = deps.followSignal;
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      try {
        const size = statSync(paths.logFile).size;
        if (size < offset) offset = 0; // dirotasi
        if (size > offset) {
          const buf = readFileSync(paths.logFile);
          out(buf.subarray(offset).toString("utf8"));
          offset = size;
        }
      } catch {
        /* file sementara hilang (rotasi) */
      }
    }, 500);
    const finish = () => {
      clearInterval(timer);
      resolve();
    };
    signal?.addEventListener("abort", finish);
    process.once("SIGINT", finish);
  });
  return EXIT_OK;
}

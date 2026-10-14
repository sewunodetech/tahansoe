/**
 * Mode background `start --detach` + `stop` / `status` / `logs` (ADR 0011).
 * Tanpa spawn proses nyata: pid file & stop file diuji di direktori temp.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  daemonPaths,
  attachDaemonRuntime,
  runningDaemon,
  stopCommand,
  statusCommand,
  logsCommand,
  startDetached,
} from "../../src/cli/commands/daemon.ts";

async function tempPaths() {
  const dir = await mkdtemp(join(tmpdir(), "tahansoe-daemon-"));
  return { dir, paths: daemonPaths({ TAHANSOE_DATA_DIR: dir }) };
}

test("attachDaemonRuntime: menulis pid file, abort saat file stop muncul, cleanup menghapus pid", async () => {
  const { dir, paths } = await tempPaths();
  try {
    const rt = attachDaemonRuntime(["--no-gateway"], paths, 20);
    const rec = runningDaemon(paths);
    assert.equal(rec?.pid, process.pid);
    assert.deepEqual(rec?.args, ["--no-gateway"]);

    await writeFile(paths.stopFile, "now");
    await new Promise<void>((resolve) => rt.signal.addEventListener("abort", () => resolve(), { once: true }));
    assert.equal(rt.signal.aborted, true);

    rt.cleanup();
    assert.equal(existsSync(paths.pidFile), false);
    assert.equal(existsSync(paths.stopFile), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runningDaemon: pid file basi (proses mati) dibersihkan", async () => {
  const { dir, paths } = await tempPaths();
  try {
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(
      paths.pidFile,
      JSON.stringify({ pid: 2_147_483_000, startedAt: new Date().toISOString(), args: [], logFile: paths.logFile }),
    );
    assert.equal(runningDaemon(paths), null);
    assert.equal(existsSync(paths.pidFile), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop: tanpa daemon → pesan jelas, exit 0", async () => {
  const { dir, paths } = await tempPaths();
  const out: string[] = [];
  try {
    const code = await stopCommand([], { paths, stdout: (s) => out.push(s) });
    assert.equal(code, 0);
    assert.match(out.join(""), /tidak sedang berjalan/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop --force: memanggil kill pada pid daemon dan membersihkan pid file", async () => {
  const { dir, paths } = await tempPaths();
  const killed: Array<[number, unknown]> = [];
  try {
    const rt = attachDaemonRuntime([], paths, 10_000); // pid file = proses test (hidup)
    const code = await stopCommand(["--force"], {
      paths,
      stdout: () => {},
      killImpl: (pid, sig) => void killed.push([pid, sig]),
    });
    rt.cleanup();
    assert.equal(code, 0);
    assert.deepEqual(killed, [[process.pid, "SIGKILL"]]);
    assert.equal(existsSync(paths.pidFile), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("start --detach: menolak bila daemon sudah berjalan", async () => {
  const { dir, paths } = await tempPaths();
  const err: string[] = [];
  let spawned = false;
  try {
    const rt = attachDaemonRuntime([], paths, 10_000);
    const code = await startDetached([], {
      paths,
      stdout: () => {},
      stderr: (s) => err.push(s),
      spawnImpl: (() => {
        spawned = true;
        throw new Error("tidak boleh spawn");
      }) as never,
    });
    rt.cleanup();
    assert.equal(code, 1);
    assert.equal(spawned, false);
    assert.match(err.join(""), /sudah berjalan/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("status --json: running + lastRun dari loader", async () => {
  const { dir, paths } = await tempPaths();
  const out: string[] = [];
  try {
    const rt = attachDaemonRuntime([], paths, 10_000);
    await statusCommand(["--json"], { paths, stdout: (s) => out.push(s), lastRun: async () => "2026-10-14 10:00 UTC · CALM UP" });
    rt.cleanup();
    const j = JSON.parse(out.join(""));
    assert.equal(j.running, true);
    assert.equal(j.pid, process.pid);
    assert.equal(j.lastRun, "2026-10-14 10:00 UTC · CALM UP");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("logs -n: menampilkan N baris terakhir; tanpa log → pesan jelas", async () => {
  const { dir, paths } = await tempPaths();
  const out: string[] = [];
  try {
    await logsCommand([], { paths, stdout: (s) => out.push(s) });
    assert.match(out.join(""), /Belum ada log/);

    await mkdir(paths.logDir, { recursive: true });
    await writeFile(paths.logFile, "a\nb\nc\nd\n");
    out.length = 0;
    await logsCommand(["-n", "2"], { paths, stdout: (s) => out.push(s) });
    assert.equal(out.join(""), "c\nd\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("logs -f: mencetak baris baru lalu berhenti saat signal abort", async () => {
  const { dir, paths } = await tempPaths();
  const out: string[] = [];
  const ac = new AbortController();
  try {
    await mkdir(paths.logDir, { recursive: true });
    await writeFile(paths.logFile, "old\n");
    const p = logsCommand(["-f"], { paths, stdout: (s) => out.push(s), followSignal: ac.signal });
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(paths.logFile, "old\nnew line\n");
    await new Promise((r) => setTimeout(r, 800));
    ac.abort();
    await p;
    assert.match(out.join(""), /new line/);
    assert.equal((await readFile(paths.logFile, "utf8")).includes("new line"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop: pid file basi (pid hidup tapi bukan daemon, file stop tak diambil) → tidak di-kill", async () => {
  const { dir, paths } = await tempPaths();
  const killed: number[] = [];
  const err: string[] = [];
  try {
    await mkdir(paths.dataDir, { recursive: true });
    // pid = proses test (hidup) tetapi TIDAK memantau file stop → meniru pid dipakai ulang.
    await writeFile(
      paths.pidFile,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), args: [], logFile: paths.logFile }),
    );
    const code = await stopCommand([], {
      paths,
      graceMs: 300,
      stdout: () => {},
      stderr: (s) => err.push(s),
      killImpl: (pid) => void killed.push(pid),
    });
    assert.equal(code, 0);
    assert.deepEqual(killed, [], "proses asing tidak boleh di-kill");
    assert.equal(existsSync(paths.pidFile), false, "pid file basi dihapus");
    assert.match(err.join(""), /basi/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop: daemon mengambil file stop tapi macet → force kill", async () => {
  const { dir, paths } = await tempPaths();
  const killed: number[] = [];
  try {
    const rt = attachDaemonRuntime([], paths, 20); // mengambil (menghapus) file stop
    const code = await stopCommand([], {
      paths,
      graceMs: 300,
      stdout: () => {},
      stderr: () => {},
      killImpl: (pid) => void killed.push(pid),
    });
    rt.cleanup();
    assert.equal(code, 0);
    assert.deepEqual(killed, [process.pid]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

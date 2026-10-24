/**
 * Keeper Execution Engine (docs/plans/phase-4-7.md Step 3, security.md I1, I4).
 *
 * Memanggil `protect(...)` ketika HF < trigger dan kuota pelunasan (quote) > 0.
 * Invariant I4: Kunci keeper hanya bisa memanggil `protect(...)` on-chain,
 * sehingga kompromi terburuk hanya "utang user dibayar lebih awal", tanpa risiko kehilangan dana.
 *
 * Mendukung Guardian v2, v3, AaveV4, dan Morpho Blue melalui GuardianAdapter.
 *
 * Aturan:
 *  - Tanpa KEEPER_PRIVATE_KEY -> Mode Dry-Run (hanya mencatat rencana aksi, tanpa tx)
 *  - Tidak boleh lebih dari 1 transaksi in-flight per user
 *  - Back off eksponensial bila transaksi revert atau simulasi gagal
 *  - Menghormati prioritas aset utang user per spec (AaveV4)
 *  - Menyertakan positionKey pada log, pesan dry-run, dan hasil eksekusi
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { guardianAbi, guardianAaveV4Abi, guardianMorphoAbi } from "./abi.ts";
import type { KeeperExecutionResult } from "./types.ts";
import type { GuardianAdapter, GuardianPosition, GuardianProtocol } from "./adapters.ts";
import { buildPositionKey } from "./adapters.ts";

export interface KeeperOptions {
  privateKey?: string;
  publicClient?: PublicClient;
  walletClient?: WalletClient;
  rpcUrl?: string;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  now?: () => number;
  /** Injectable protect caller for unit tests */
  protectCaller?: (guardianAddress: Address, user: Address, key?: string) => Promise<`0x${string}`>;
}

export class Keeper {
  private readonly privateKey?: string;
  private readonly publicClient?: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  private readonly getNow: () => number;
  private readonly protectCaller?: (guardianAddress: Address, user: Address, key?: string) => Promise<`0x${string}`>;

  private readonly inFlightUsers = new Set<string>();
  private readonly revertBackoff = new Map<string, { count: number; nextAttemptAt: number }>();

  constructor(options: KeeperOptions = {}) {
    this.privateKey = options.privateKey?.trim();
    this.publicClient = options.publicClient;
    this.baseBackoffMs = options.baseBackoffMs ?? 60_000; // 1 menit default
    this.maxBackoffMs = options.maxBackoffMs ?? 15 * 60_000; // 15 menit max
    this.logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.getNow = options.now ?? (() => Date.now());
    this.protectCaller = options.protectCaller;

    if (this.privateKey && !options.walletClient && !this.protectCaller) {
      try {
        const pk = this.privateKey.startsWith("0x")
          ? (this.privateKey as `0x${string}`)
          : (`0x${this.privateKey}` as `0x${string}`);
        const account = privateKeyToAccount(pk);
        this.walletClient = createWalletClient({
          account,
          chain: arbitrumSepolia,
          transport: http(options.rpcUrl),
        });
      } catch (err) {
        this.logger.warn(`[keeper] format private key tidak valid, fallback ke dry-run: ${err}`);
      }
    } else {
      this.walletClient = options.walletClient;
    }
  }

  public isDryRun(): boolean {
    return !this.protectCaller && (!this.privateKey || !this.walletClient);
  }

  public async evaluateAndProtect(params: {
    user: Address;
    guardianAddress: Address;
    hf: number;
    triggerHf: number;
    quoteAmount: bigint;
    positionKey?: string;
    protocol?: GuardianProtocol;
    key?: string; // debtAsset or marketId
    adapter?: GuardianAdapter;
    guardianVersion?: number;
  }): Promise<KeeperExecutionResult> {
    const userKey = params.user.toLowerCase() as Address;
    const guardianKey = params.guardianAddress.toLowerCase() as Address;
    const protocol = params.protocol ?? (params.adapter?.protocol ?? "aave-v3");
    const key = params.key;
    const positionKey = params.positionKey ?? (key ? buildPositionKey({
      protocol,
      chainId: params.adapter?.chainId ?? 421614,
      guardian: guardianKey,
      key,
    }) : undefined);

    const posDisplay = positionKey ?? userKey;

    // 1. Validasi kebutuhan proteksi
    if (params.hf >= params.triggerHf || params.quoteAmount <= 0n) {
      return {
        user: userKey,
        guardianAddress: guardianKey,
        positionKey,
        protocol,
        key,
        status: "no_action_needed",
        quoteAmount: params.quoteAmount,
      };
    }

    // 2. Cegah lebih dari 1 in-flight tx per user
    if (this.inFlightUsers.has(userKey)) {
      this.logger.info(`[keeper] transaksi untuk ${userKey} (${posDisplay}) masih in-flight, lewati tick ini.`);
      return {
        user: userKey,
        guardianAddress: guardianKey,
        positionKey,
        protocol,
        key,
        status: "skipped_in_flight",
        quoteAmount: params.quoteAmount,
      };
    }

    // 3. Cek backoff jika sebelumnya pernah revert
    const now = this.getNow();
    const backoffKey = (positionKey ?? userKey).toLowerCase();
    const backoff = this.revertBackoff.get(backoffKey) ?? this.revertBackoff.get(userKey);
    if (backoff && now < backoff.nextAttemptAt) {
      const waitSec = Math.ceil((backoff.nextAttemptAt - now) / 1000);
      this.logger.warn(
        `[keeper] posisi ${posDisplay} sedang dalam cooldown backoff (${waitSec}s tersisa setelah revert #${backoff.count}).`,
      );
      return {
        user: userKey,
        guardianAddress: guardianKey,
        positionKey,
        protocol,
        key,
        status: "skipped_backoff",
        quoteAmount: params.quoteAmount,
      };
    }

    // 4. Mode Dry-Run (tidak ada signer / private key)
    if (this.isDryRun()) {
      this.logger.info(
        `[keeper] DRY RUN: akan memanggil protect(position=${posDisplay}, user=${userKey}) pada Guardian ${guardianKey} (kuota repay: ${params.quoteAmount}).`,
      );
      return {
        user: userKey,
        guardianAddress: guardianKey,
        positionKey,
        protocol,
        key,
        status: "dry_run",
        quoteAmount: params.quoteAmount,
      };
    }

    // 5. Eksekusi Live on-chain (hanya memanggil protect, I4)
    this.inFlightUsers.add(userKey);
    try {
      this.logger.info(`[keeper] mengeksekusi protect(${posDisplay}) pada ${guardianKey}...`);

      let txHash: `0x${string}`;
      if (this.protectCaller) {
        txHash = await this.protectCaller(guardianKey, userKey, key);
      } else if (params.adapter) {
        txHash = await params.adapter.protect({
          user: userKey,
          key: key ?? "",
          positionKey: posDisplay,
          protocol,
          guardianAddress: guardianKey,
        });
      } else if (this.walletClient) {
        const version = params.guardianVersion ?? (key && key !== guardianKey && key.length === 42 ? 4 : 1);
        if (protocol === "morpho-blue" && key) {
          txHash = await this.walletClient.writeContract({
            address: guardianKey,
            abi: guardianMorphoAbi,
            functionName: "protect",
            args: [userKey, key as `0x${string}`],
          } as any);
        } else if (protocol === "aave-v3" && version >= 4 && key) {
          txHash = await this.walletClient.writeContract({
            address: guardianKey,
            abi: guardianAaveV4Abi,
            functionName: "protect",
            args: [userKey, key as Address],
          } as any);
        } else {
          txHash = await this.walletClient.writeContract({
            address: guardianKey,
            abi: guardianAbi,
            functionName: "protect",
            args: [userKey],
          } as any);
        }

        if (this.publicClient) {
          const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
          if (receipt.status === "reverted") {
            throw new Error(`Tx reverted on-chain: ${txHash}`);
          }
        }
      } else {
        throw new Error("No walletClient available");
      }

      // Berhasil: reset catatan backoff
      this.revertBackoff.delete(backoffKey);
      this.revertBackoff.delete(userKey);
      this.logger.info(`[keeper] protect berhasil dieksekusi untuk ${posDisplay}: tx=${txHash}`);

      return {
        user: userKey,
        guardianAddress: guardianKey,
        positionKey,
        protocol,
        key,
        status: "executed",
        quoteAmount: params.quoteAmount,
        txHash,
      };
    } catch (err) {
      // Gagal / Revert: hitung backoff eksponensial
      const prevCount = backoff?.count ?? 0;
      const count = prevCount + 1;
      const delayMs = Math.min(
        this.baseBackoffMs * 2 ** (count - 1),
        this.maxBackoffMs,
      );
      const nextAttemptAt = now + delayMs;
      this.revertBackoff.set(backoffKey, { count, nextAttemptAt });
      this.revertBackoff.set(userKey, { count, nextAttemptAt });

      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[keeper] protect revert/gagal untuk ${posDisplay}: ${errMsg}. Backing off selama ${Math.round(delayMs / 1000)}s.`,
      );

      return {
        user: userKey,
        guardianAddress: guardianKey,
        positionKey,
        protocol,
        key,
        status: "failed",
        quoteAmount: params.quoteAmount,
        error: errMsg,
      };
    } finally {
      this.inFlightUsers.delete(userKey);
    }
  }

  /**
   * Evaluasi dan proteksi untuk satu posisi GuardianPosition dari adapter.
   */
  public async evaluateAndProtectPosition(
    adapter: GuardianAdapter,
    position: GuardianPosition,
    opts: { hf?: number; triggerHf?: number } = {},
  ): Promise<KeeperExecutionResult> {
    const quote = await adapter.evaluateProtection(position);
    if (!quote.needsProtection || quote.quoteAmount <= 0n) {
      return {
        user: position.user,
        guardianAddress: position.guardianAddress,
        positionKey: position.positionKey,
        protocol: position.protocol,
        key: position.key,
        status: "no_action_needed",
        quoteAmount: quote.quoteAmount,
      };
    }

    const hf = opts.hf ?? 1.0;
    const triggerHf = opts.triggerHf ?? 1.3;

    return this.evaluateAndProtect({
      user: position.user,
      guardianAddress: position.guardianAddress,
      guardianVersion: adapter.version,
      positionKey: position.positionKey,
      protocol: position.protocol,
      key: position.key,
      hf,
      triggerHf,
      quoteAmount: quote.quoteAmount,
      adapter,
    });
  }

  /**
   * Menjalankan satu siklus keeper di seluruh adapter yang dipantau.
   * Menghormati prioritas per spec dan membatasi 1 aset utang per user per tick.
   */
  public async runTick(adapters: GuardianAdapter[]): Promise<KeeperExecutionResult[]> {
    const results: KeeperExecutionResult[] = [];

    for (const adapter of adapters) {
      try {
        let positions = await adapter.getPositions();
        if (adapter.prioritizePositions) {
          positions = await adapter.prioritizePositions(positions);
        }

        for (const pos of positions) {
          const res = await this.evaluateAndProtectPosition(adapter, pos);
          if (res.status !== "no_action_needed") {
            results.push(res);
          }
        }
      } catch (err) {
        this.logger.error(
          `[keeper] gagal mengevaluasi adapter ${adapter.guardianAddress} (${adapter.protocol}): ${err}`,
        );
      }
    }

    return results;
  }
}

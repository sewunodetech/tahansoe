/**
 * Keeper Execution Engine (docs/plans/phase-4-7.md Step 3, security.md I1, I4).
 *
 * Memanggil `protect(user)` ketika HF < trigger dan kuota pelunasan (quote) > 0.
 * Invariant I4: Kunci keeper hanya bisa memanggil `protect(user)` on-chain,
 * sehingga kompromi terburuk hanya "utang user dibayar lebih awal", tanpa risiko kehilangan dana.
 *
 * Aturan:
 *  - Tanpa KEEPER_PRIVATE_KEY -> Mode Dry-Run (hanya mencatat rencana aksi, tanpa tx)
 *  - Tidak boleh lebih dari 1 transaksi in-flight per user
 *  - Back off eksponensial bila transaksi revert atau simulasi gagal
 *  - Per ADR 0006: Proteksi statis gratis untuk semua user berpolicy aktif
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
import { guardianAbi } from "./abi.ts";
import type { KeeperExecutionResult } from "./types.ts";

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
  protectCaller?: (guardianAddress: Address, user: Address) => Promise<`0x${string}`>;
}

export class Keeper {
  private readonly privateKey?: string;
  private readonly publicClient?: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  private readonly getNow: () => number;
  private readonly protectCaller?: (guardianAddress: Address, user: Address) => Promise<`0x${string}`>;

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
  }): Promise<KeeperExecutionResult> {
    const userKey = params.user.toLowerCase() as Address;
    const guardianKey = params.guardianAddress.toLowerCase() as Address;

    // 1. Validasi kebutuhan proteksi
    if (params.hf >= params.triggerHf || params.quoteAmount <= 0n) {
      return {
        user: userKey,
        guardianAddress: guardianKey,
        status: "no_action_needed",
        quoteAmount: params.quoteAmount,
      };
    }

    // 2. Cegah lebih dari 1 in-flight tx per user
    if (this.inFlightUsers.has(userKey)) {
      this.logger.info(`[keeper] transaksi untuk ${userKey} masih in-flight, lewati tick ini.`);
      return {
        user: userKey,
        guardianAddress: guardianKey,
        status: "skipped_in_flight",
        quoteAmount: params.quoteAmount,
      };
    }

    // 3. Cek backoff jika sebelumnya pernah revert
    const now = this.getNow();
    const backoff = this.revertBackoff.get(userKey);
    if (backoff && now < backoff.nextAttemptAt) {
      const waitSec = Math.ceil((backoff.nextAttemptAt - now) / 1000);
      this.logger.warn(
        `[keeper] posisi ${userKey} sedang dalam cooldown backoff (${waitSec}s tersisa setelah revert #${backoff.count}).`,
      );
      return {
        user: userKey,
        guardianAddress: guardianKey,
        status: "skipped_backoff",
        quoteAmount: params.quoteAmount,
      };
    }

    // 4. Mode Dry-Run (tidak ada signer / private key)
    if (this.isDryRun()) {
      this.logger.info(
        `[keeper] DRY RUN: akan memanggil protect(user=${userKey}) pada Guardian ${guardianKey} (kuota repay: ${params.quoteAmount}).`,
      );
      return {
        user: userKey,
        guardianAddress: guardianKey,
        status: "dry_run",
        quoteAmount: params.quoteAmount,
      };
    }

    // 5. Eksekusi Live on-chain
    this.inFlightUsers.add(userKey);
    try {
      this.logger.info(`[keeper] mengeksekusi protect(${userKey}) pada ${guardianKey}...`);

      let txHash: `0x${string}`;
      if (this.protectCaller) {
        txHash = await this.protectCaller(guardianKey, userKey);
      } else if (this.walletClient) {
        txHash = await this.walletClient.writeContract({
          address: guardianKey,
          abi: guardianAbi,
          functionName: "protect",
          args: [userKey],
        } as any);

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
      this.revertBackoff.delete(userKey);
      this.logger.info(`[keeper] protect berhasil dieksekusi untuk ${userKey}: tx=${txHash}`);

      return {
        user: userKey,
        guardianAddress: guardianKey,
        status: "executed",
        quoteAmount: params.quoteAmount,
        txHash,
      };
    } catch (err) {
      // Gagal / Revert: hitung backoff eksponensial
      const prevCount = this.revertBackoff.get(userKey)?.count ?? 0;
      const count = prevCount + 1;
      const delayMs = Math.min(
        this.baseBackoffMs * 2 ** (count - 1),
        this.maxBackoffMs,
      );
      this.revertBackoff.set(userKey, {
        count,
        nextAttemptAt: now + delayMs,
      });

      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[keeper] protect revert/gagal untuk ${userKey}: ${errMsg}. Backing off selama ${Math.round(delayMs / 1000)}s.`,
      );

      return {
        user: userKey,
        guardianAddress: guardianKey,
        status: "failed",
        quoteAmount: params.quoteAmount,
        error: errMsg,
      };
    } finally {
      this.inFlightUsers.delete(userKey);
    }
  }
}

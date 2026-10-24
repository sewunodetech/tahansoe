/**
 * Version-aware Guardian Adapters (Spec sections 3.4 & 3.6).
 *
 * Mendukung:
 *  - v2/v3: usersPage -> (user, debtAsset), needsProtection(user), protect(user)
 *  - AaveV4: positionsPage -> (user, debtAsset), needsProtection(user, debtAsset),
 *            quoteProtect(user, debtAsset), protect(user, debtAsset),
 *            debtAssetsOf(user) prioritas
 *  - Morpho: positionsPage -> (user, marketId), needsProtection(user, marketId),
 *            quoteProtect(user, marketId), protect(user, marketId)
 */

import type { PublicClient, WalletClient } from "viem";
import type { Address, ChainConfig } from "@tahansoe/domain";
import {
  guardianAbi,
  guardianV2Abi,
  guardianAaveV4Abi,
  guardianMorphoAbi,
} from "./abi.ts";

export type GuardianProtocol = "aave-v3" | "morpho-blue";

export interface DiscoveredGuardian {
  address: Address;
  version: number;
  deployedBlock: number;
  protocol: GuardianProtocol;
}

export interface GuardianPosition {
  user: Address;
  key: string; // debtAsset (address) atau marketId (bytes32 hex)
  positionKey: string;
  protocol: GuardianProtocol;
  guardianAddress: Address;
}

export interface GuardianProtectionQuote {
  needsProtection: boolean;
  quoteAmount: bigint;
  expectedHf?: bigint;
}

export interface GuardianAdapterOptions {
  chainId: number;
  guardianAddress: Address;
  version: number;
  protocol: GuardianProtocol;
  client?: PublicClient;
  walletClient?: WalletClient;
  protectCaller?: (guardian: Address, user: Address, key?: string) => Promise<`0x${string}`>;
}

export interface GuardianAdapter {
  readonly protocol: GuardianProtocol;
  readonly version: number;
  readonly guardianAddress: Address;
  readonly chainId: number;

  getPositions(pageSize?: number): Promise<GuardianPosition[]>;
  evaluateProtection(position: GuardianPosition): Promise<GuardianProtectionQuote>;
  protect(position: GuardianPosition): Promise<`0x${string}`>;
  prioritizePositions?(positions: GuardianPosition[]): Promise<GuardianPosition[]>;
}

/**
 * Membentuk positionKey standar per spec:
 *  - aave-v3:<chainId>:<guardian>:<debtAsset>
 *  - morpho-blue:<chainId>:<guardian>:<marketId>
 * (seluruh komponen berhuruf kecil)
 */
export function buildPositionKey(params: {
  protocol: GuardianProtocol;
  chainId: number;
  guardian: Address | string;
  key: Address | string;
}): string {
  return `${params.protocol}:${params.chainId}:${params.guardian.toLowerCase()}:${params.key.toLowerCase()}`;
}

/**
 * Discovery Guardian dari registry per chain.
 * TODO: ganti dengan helper dari @tahansoe/domain setelah Task B selesai di-merge.
 */
export function getGuardiansForChain(chain: ChainConfig): DiscoveredGuardian[] {
  const list = chain.guardians && chain.guardians.length > 0
    ? chain.guardians
    : chain.guardian
      ? [{ version: 1, address: chain.guardian, deployedBlock: 0 }]
      : [];

  return list.map((g) => ({
    address: g.address.toLowerCase() as Address,
    version: g.version,
    deployedBlock: g.deployedBlock ?? 0,
    protocol: ((g as { protocol?: string }).protocol ?? "aave-v3") as GuardianProtocol,
  }));
}

// ─── V2/V3 Guardian Adapter ──────────────────────────────────────────────────

export class V2V3GuardianAdapter implements GuardianAdapter {
  readonly protocol: GuardianProtocol = "aave-v3";
  readonly version: number;
  readonly guardianAddress: Address;
  readonly chainId: number;
  private readonly client?: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly protectCaller?: (guardian: Address, user: Address, key?: string) => Promise<`0x${string}`>;

  constructor(options: GuardianAdapterOptions) {
    this.chainId = options.chainId;
    this.guardianAddress = options.guardianAddress.toLowerCase() as Address;
    this.version = options.version;
    this.client = options.client;
    this.walletClient = options.walletClient;
    this.protectCaller = options.protectCaller;
  }

  async getPositions(pageSize = 100): Promise<GuardianPosition[]> {
    if (!this.client) return [];
    const positions: GuardianPosition[] = [];
    let offset = 0n;
    const limit = BigInt(pageSize);

    while (true) {
      const users = await this.client.readContract({
        address: this.guardianAddress,
        abi: guardianV2Abi,
        functionName: "usersPage",
        args: [offset, limit],
      }) as Address[];

      if (!users || users.length === 0) break;

      for (const u of users) {
        const userAddr = u.toLowerCase() as Address;
        try {
          const pol = await this.client.readContract({
            address: this.guardianAddress,
            abi: guardianV2Abi,
            functionName: "policies",
            args: [userAddr],
          }) as [boolean, Address, bigint, bigint, bigint] | { enabled: boolean; debtAsset: Address };

          const enabled = Array.isArray(pol) ? pol[0] : pol.enabled;
          const debtAsset = (Array.isArray(pol) ? pol[1] : pol.debtAsset).toLowerCase() as Address;

          if (enabled) {
            positions.push({
              user: userAddr,
              key: debtAsset,
              positionKey: buildPositionKey({
                protocol: "aave-v3",
                chainId: this.chainId,
                guardian: this.guardianAddress,
                key: debtAsset,
              }),
              protocol: "aave-v3",
              guardianAddress: this.guardianAddress,
            });
          }
        } catch {
          // Abaikan jika user tidak memiliki policy valid
        }
      }

      if (users.length < pageSize) break;
      offset += BigInt(users.length);
    }

    return positions;
  }

  async evaluateProtection(position: GuardianPosition): Promise<GuardianProtectionQuote> {
    if (!this.client) {
      return { needsProtection: false, quoteAmount: 0n };
    }

    const needs = await this.client.readContract({
      address: this.guardianAddress,
      abi: guardianAbi,
      functionName: "needsProtection",
      args: [position.user],
    }) as boolean;

    if (!needs) {
      return { needsProtection: false, quoteAmount: 0n };
    }

    const quote = await this.client.readContract({
      address: this.guardianAddress,
      abi: guardianAbi,
      functionName: "quoteProtect",
      args: [position.user],
    }) as [bigint, bigint, bigint, bigint, bigint];

    // quote: [l1Repay, l2Repay, l3Collateral, l3Repay, expectedHF]
    const quoteAmount = quote[0] + quote[1] + quote[3];
    return {
      needsProtection: true,
      quoteAmount,
      expectedHf: quote[4],
    };
  }

  async protect(position: GuardianPosition): Promise<`0x${string}`> {
    if (this.protectCaller) {
      return await this.protectCaller(this.guardianAddress, position.user, position.key);
    }
    if (this.walletClient) {
      return await this.walletClient.writeContract({
        address: this.guardianAddress,
        abi: guardianAbi,
        functionName: "protect",
        args: [position.user],
      } as any);
    }
    throw new Error("No walletClient or protectCaller configured for V2V3GuardianAdapter");
  }
}

// ─── Aave V4 Guardian Adapter ────────────────────────────────────────────────

export class AaveV4GuardianAdapter implements GuardianAdapter {
  readonly protocol: GuardianProtocol = "aave-v3";
  readonly version: number;
  readonly guardianAddress: Address;
  readonly chainId: number;
  private readonly client?: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly protectCaller?: (guardian: Address, user: Address, key?: string) => Promise<`0x${string}`>;

  constructor(options: GuardianAdapterOptions) {
    this.chainId = options.chainId;
    this.guardianAddress = options.guardianAddress.toLowerCase() as Address;
    this.version = options.version;
    this.client = options.client;
    this.walletClient = options.walletClient;
    this.protectCaller = options.protectCaller;
  }

  async getPositions(pageSize = 100): Promise<GuardianPosition[]> {
    if (!this.client) return [];
    const positions: GuardianPosition[] = [];
    let offset = 0n;
    const limit = BigInt(pageSize);

    while (true) {
      const [users, debtAssets] = await this.client.readContract({
        address: this.guardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "positionsPage",
        args: [offset, limit],
      }) as [Address[], Address[]];

      if (!users || users.length === 0) break;

      for (let i = 0; i < users.length; i++) {
        const u = users[i]!.toLowerCase() as Address;
        const d = debtAssets[i]!.toLowerCase() as Address;
        positions.push({
          user: u,
          key: d,
          positionKey: buildPositionKey({
            protocol: "aave-v3",
            chainId: this.chainId,
            guardian: this.guardianAddress,
            key: d,
          }),
          protocol: "aave-v3",
          guardianAddress: this.guardianAddress,
        });
      }

      if (users.length < pageSize) break;
      offset += BigInt(users.length);
    }

    return positions;
  }

  async getDebtAssetsOf(user: Address): Promise<Address[]> {
    if (!this.client) return [];
    const assets = await this.client.readContract({
      address: this.guardianAddress,
      abi: guardianAaveV4Abi,
      functionName: "debtAssetsOf",
      args: [user],
    }) as Address[];
    return assets.map((a) => a.toLowerCase() as Address);
  }

  async evaluateProtection(position: GuardianPosition): Promise<GuardianProtectionQuote> {
    if (!this.client) {
      return { needsProtection: false, quoteAmount: 0n };
    }

    const needs = await this.client.readContract({
      address: this.guardianAddress,
      abi: guardianAaveV4Abi,
      functionName: "needsProtection",
      args: [position.user, position.key as Address],
    }) as boolean;

    if (!needs) {
      return { needsProtection: false, quoteAmount: 0n };
    }

    const quote = await this.client.readContract({
      address: this.guardianAddress,
      abi: guardianAaveV4Abi,
      functionName: "quoteProtect",
      args: [position.user, position.key as Address],
    }) as [bigint, bigint, bigint, bigint];

    // quote: [l1Repay, l2Repay, l3Repay, expectedHf]
    const quoteAmount = quote[0] + quote[1] + quote[2];
    return {
      needsProtection: true,
      quoteAmount,
      expectedHf: quote[3],
    };
  }

  /**
   * Prioritas per spec:
   * Menghormati prioritas dari `debtAssetsOf(user)`.
   * Dalam 1 keeper tick, proteksi maksimal 1 aset utang per user (yang berprioritas tertinggi yang butuh proteksi).
   */
  async prioritizePositions(positions: GuardianPosition[]): Promise<GuardianPosition[]> {
    const userMap = new Map<string, GuardianPosition[]>();
    for (const pos of positions) {
      const u = pos.user.toLowerCase();
      const list = userMap.get(u) ?? [];
      list.push(pos);
      userMap.set(u, list);
    }

    const prioritized: GuardianPosition[] = [];

    for (const [user, list] of userMap.entries()) {
      if (list.length === 1) {
        prioritized.push(list[0]!);
        continue;
      }

      // Ambil prioritas urutan aset utang user
      let priorityOrder: Address[] = [];
      try {
        priorityOrder = await this.getDebtAssetsOf(user as Address);
      } catch {
        priorityOrder = list.map((p) => p.key as Address);
      }

      const orderMap = new Map<string, number>();
      priorityOrder.forEach((asset, idx) => {
        orderMap.set(asset.toLowerCase(), idx);
      });

      list.sort((a, b) => {
        const idxA = orderMap.get(a.key.toLowerCase()) ?? 999;
        const idxB = orderMap.get(b.key.toLowerCase()) ?? 999;
        return idxA - idxB;
      });

      // Pilih aset pertama dalam urutan prioritas yang memerlukan proteksi
      let selected: GuardianPosition | null = null;
      for (const pos of list) {
        const evalRes = await this.evaluateProtection(pos);
        if (evalRes.needsProtection && evalRes.quoteAmount > 0n) {
          selected = pos;
          break; // Maksimal 1 per user per tick!
        }
      }

      // Jika ada yang butuh proteksi, ambil hanya yang itu; bila tidak ada, simpan aset prioritas tertinggi
      prioritized.push(selected ?? list[0]!);
    }

    return prioritized;
  }

  async protect(position: GuardianPosition): Promise<`0x${string}`> {
    if (this.protectCaller) {
      return await this.protectCaller(this.guardianAddress, position.user, position.key);
    }
    if (this.walletClient) {
      return await this.walletClient.writeContract({
        address: this.guardianAddress,
        abi: guardianAaveV4Abi,
        functionName: "protect",
        args: [position.user, position.key as Address],
      } as any);
    }
    throw new Error("No walletClient or protectCaller configured for AaveV4GuardianAdapter");
  }
}

// ─── Morpho Blue Guardian Adapter ────────────────────────────────────────────

export class MorphoGuardianAdapter implements GuardianAdapter {
  readonly protocol: GuardianProtocol = "morpho-blue";
  readonly version: number;
  readonly guardianAddress: Address;
  readonly chainId: number;
  private readonly client?: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly protectCaller?: (guardian: Address, user: Address, key?: string) => Promise<`0x${string}`>;

  constructor(options: GuardianAdapterOptions) {
    this.chainId = options.chainId;
    this.guardianAddress = options.guardianAddress.toLowerCase() as Address;
    this.version = options.version;
    this.client = options.client;
    this.walletClient = options.walletClient;
    this.protectCaller = options.protectCaller;
  }

  async getPositions(pageSize = 100): Promise<GuardianPosition[]> {
    if (!this.client) return [];
    const positions: GuardianPosition[] = [];
    let offset = 0n;
    const limit = BigInt(pageSize);

    while (true) {
      const [users, marketIds] = await this.client.readContract({
        address: this.guardianAddress,
        abi: guardianMorphoAbi,
        functionName: "positionsPage",
        args: [offset, limit],
      }) as [Address[], `0x${string}`[]];

      if (!users || users.length === 0) break;

      for (let i = 0; i < users.length; i++) {
        const u = users[i]!.toLowerCase() as Address;
        const m = marketIds[i]!.toLowerCase();
        positions.push({
          user: u,
          key: m,
          positionKey: buildPositionKey({
            protocol: "morpho-blue",
            chainId: this.chainId,
            guardian: this.guardianAddress,
            key: m,
          }),
          protocol: "morpho-blue",
          guardianAddress: this.guardianAddress,
        });
      }

      if (users.length < pageSize) break;
      offset += BigInt(users.length);
    }

    return positions;
  }

  async evaluateProtection(position: GuardianPosition): Promise<GuardianProtectionQuote> {
    if (!this.client) {
      return { needsProtection: false, quoteAmount: 0n };
    }

    const needs = await this.client.readContract({
      address: this.guardianAddress,
      abi: guardianMorphoAbi,
      functionName: "needsProtection",
      args: [position.user, position.key as `0x${string}`],
    }) as boolean;

    if (!needs) {
      return { needsProtection: false, quoteAmount: 0n };
    }

    const quote = await this.client.readContract({
      address: this.guardianAddress,
      abi: guardianMorphoAbi,
      functionName: "quoteProtect",
      args: [position.user, position.key as `0x${string}`],
    }) as [bigint, bigint, bigint];

    // quote: [l1Repay, l2Repay, expectedHf]
    const quoteAmount = quote[0] + quote[1];
    return {
      needsProtection: true,
      quoteAmount,
      expectedHf: quote[2],
    };
  }

  async protect(position: GuardianPosition): Promise<`0x${string}`> {
    if (this.protectCaller) {
      return await this.protectCaller(this.guardianAddress, position.user, position.key);
    }
    if (this.walletClient) {
      return await this.walletClient.writeContract({
        address: this.guardianAddress,
        abi: guardianMorphoAbi,
        functionName: "protect",
        args: [position.user, position.key as `0x${string}`],
      } as any);
    }
    throw new Error("No walletClient or protectCaller configured for MorphoGuardianAdapter");
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createGuardianAdapter(options: GuardianAdapterOptions): GuardianAdapter {
  if (options.protocol === "morpho-blue") {
    return new MorphoGuardianAdapter(options);
  }
  if (options.version >= 4) {
    return new AaveV4GuardianAdapter(options);
  }
  return new V2V3GuardianAdapter(options);
}

/**
 * Faucet (spec §3.5): ETH via anvil_setBalance, ERC-20 via anvil_setStorageAt on the
 * token's balance mapping slot. Per-session cumulative caps: 100 ETH (ETH + WETH
 * together) and 50,000 USDC.
 */

import { encodeAbiParameters, keccak256, pad, parseUnits, type Address, type Hex } from "viem";
import { erc20Abi } from "./abis.ts";
import { LIMITS, TOKEN_SLOTS } from "./config.ts";
import type { ForkClient } from "./fork-client.ts";
import { toHex } from "./rpc.ts";

export const FAUCET_ASSETS = ["ETH", "WETH", "USDC"] as const;
export type FaucetAsset = (typeof FAUCET_ASSETS)[number];

export class FaucetLimitError extends Error {
  constructor(
    readonly asset: FaucetAsset,
    readonly remaining: number,
  ) {
    super(`faucet limit reached for ${asset}: ${remaining} remaining this session`);
  }
}

/** Tracks what a session has drawn. Pure; the chain writes happen in `Faucet`. */
export class FaucetLedger {
  private eth = 0;
  private usdc = 0;

  constructor(private readonly caps = { eth: LIMITS.maxEth, usdc: LIMITS.maxUsdc }) {}

  remaining(asset: FaucetAsset): number {
    return asset === "USDC" ? this.caps.usdc - this.usdc : this.caps.eth - this.eth;
  }

  /** Reserves `amount`; throws FaucetLimitError if it would exceed the cap. */
  reserve(asset: FaucetAsset, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be positive");
    const left = this.remaining(asset);
    if (amount > left + 1e-9) throw new FaucetLimitError(asset, Math.max(0, left));
    if (asset === "USDC") this.usdc += amount;
    else this.eth += amount;
  }

  /** Gives back a reservation after a failed chain write. */
  release(asset: FaucetAsset, amount: number): void {
    if (asset === "USDC") this.usdc = Math.max(0, this.usdc - amount);
    else this.eth = Math.max(0, this.eth - amount);
  }
}

export function balanceSlotKey(holder: Address, slot: number): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, BigInt(slot)]));
}

/** Decimal string with at most `decimals` places, so parseUnits never sees exponent notation. */
function toUnits(amount: number, decimals: number): bigint {
  return parseUnits(amount.toFixed(decimals), decimals);
}

export interface Balances {
  ETH: string;
  WETH: string;
  USDC: string;
}

export class Faucet {
  /** Discovered slots override the configured ones (e.g. after a token upgrade). */
  private readonly slots = new Map<Address, number>();

  constructor(private readonly fork: ForkClient) {}

  async fund(holder: Address, asset: FaucetAsset, amount: number): Promise<void> {
    if (asset === "ETH") {
      const cur = await this.fork.client.getBalance({ address: holder });
      await this.fork.setBalance(holder, cur + toUnits(amount, 18));
      return;
    }
    const { address, decimals } = TOKEN_SLOTS[asset];
    const cur = await this.tokenBalance(address, holder);
    await this.setTokenBalance(address, holder, cur + toUnits(amount, decimals), TOKEN_SLOTS[asset].balanceSlot);
  }

  async balances(holder: Address): Promise<Balances> {
    const [eth, weth, usdc] = await Promise.all([
      this.fork.client.getBalance({ address: holder }),
      this.tokenBalance(TOKEN_SLOTS.WETH.address, holder),
      this.tokenBalance(TOKEN_SLOTS.USDC.address, holder),
    ]);
    return { ETH: eth.toString(), WETH: weth.toString(), USDC: usdc.toString() };
  }

  private tokenBalance(token: Address, holder: Address): Promise<bigint> {
    return this.fork.read<bigint>(token, erc20Abi, "balanceOf", [holder]);
  }

  private async writeSlot(token: Address, holder: Address, slot: number, value: bigint): Promise<void> {
    await this.fork.rpc("anvil_setStorageAt", [token, balanceSlotKey(holder, slot), pad(toHex(value), { size: 32 })]);
  }

  private async setTokenBalance(token: Address, holder: Address, value: bigint, configured: number): Promise<void> {
    const slot = this.slots.get(token) ?? configured;
    if (await this.tryWrite(token, holder, slot, value)) return;

    // Configured slot is stale: probe the others.
    for (let s = 0; s <= 120; s++) {
      if (s === slot) continue;
      if (await this.tryWrite(token, holder, s, value)) {
        this.slots.set(token, s);
        return;
      }
    }
    throw new Error(`could not find balance slot for ${token}`);
  }

  /** Writes `value` at `slot`; if balanceOf does not reflect it, restores the slot and returns false. */
  private async tryWrite(token: Address, holder: Address, slot: number, value: bigint): Promise<boolean> {
    const key = balanceSlotKey(holder, slot);
    const original = await this.fork.rpc<Hex>("eth_getStorageAt", [token, key, "latest"]);
    await this.writeSlot(token, holder, slot, value);
    if ((await this.tokenBalance(token, holder)) === value) return true;
    await this.fork.rpc("anvil_setStorageAt", [token, key, pad(original, { size: 32 })]);
    return false;
  }
}

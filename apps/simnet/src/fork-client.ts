/**
 * Internal client for one anvil fork: viem reads plus "send as" via impersonation.
 * Never handed to the public proxy.
 */

import {
  createPublicClient,
  defineChain,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  TransactionReceiptNotFoundError,
} from "viem";
import { createRpc, toHex, type RpcCall } from "./rpc.ts";

export class ForkClient {
  readonly rpc: RpcCall;
  readonly client: PublicClient;

  constructor(
    readonly url: string,
    readonly chainId: number,
  ) {
    this.rpc = createRpc(url);
    const chain = defineChain({
      id: chainId,
      name: "Tahansoe Simnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [url] } },
    });
    this.client = createPublicClient({ chain, transport: http(url, { timeout: 30_000 }) });
  }

  read<T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.client.readContract({ address, abi, functionName, args }) as Promise<T>;
  }

  async setBalance(addr: Address, wei: bigint): Promise<void> {
    await this.rpc("anvil_setBalance", [addr, toHex(wei)]);
  }

  /**
   * Polls eth_getTransactionReceipt directly. viem's waitForTransactionReceipt watches
   * for new blocks, and anvil automine has usually mined the tx before watching starts,
   * so it can wait for a block that never comes.
   */
  async waitReceipt(hash: Hex, timeoutMs = 30_000): Promise<TransactionReceipt> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        return await this.client.getTransactionReceipt({ hash });
      } catch (e) {
        if (!(e instanceof TransactionReceiptNotFoundError) || Date.now() > deadline) throw e;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Sends a tx from `from` using anvil impersonation; throws if it reverts. */
  async sendAs(from: Address, to: Address, data: Hex): Promise<TransactionReceipt> {
    const balance = await this.client.getBalance({ address: from });
    if (balance < parseEther("1")) await this.setBalance(from, parseEther("100"));
    await this.rpc("anvil_impersonateAccount", [from]);
    try {
      const hash = await this.rpc<Hex>("eth_sendTransaction", [{ from, to, data }]);
      const receipt = await this.waitReceipt(hash);
      if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
      return receipt;
    } finally {
      await this.rpc("anvil_stopImpersonatingAccount", [from]).catch(() => undefined);
    }
  }
}

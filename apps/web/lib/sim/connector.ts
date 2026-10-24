/**
 * wagmi connector for the Simulation Mode burner wallet (spec m1-simulation-mode §3.5).
 * Transactions are signed in the browser with the burner key and sent as eth_sendRawTransaction
 * through the simnet RPC proxy. It only ever talks to the simulation chain.
 */

import { createWalletClient, getAddress, type Address } from "viem";
import { createConnector } from "wagmi";
import { getBurner, getOrCreateBurner } from "./burner";
import { simChain } from "./chain";
import { getSimRpcPath, simRpcRequest, simTransport } from "./rpc";

export const SIM_CONNECTOR_ID = "tahansoeSim";

type Eip1193Request = (args: { method: string; params?: unknown }) => Promise<unknown>;

export function simConnector() {
  return createConnector<{ request: Eip1193Request }>((config) => {
    const accounts = (): readonly Address[] => {
      const burner = getBurner();
      return burner ? [getAddress(burner.address)] : [];
    };

    /** Minimal EIP-1193 provider: account/chain answered locally, everything else to the fork. */
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        switch (method) {
          case "eth_accounts":
          case "eth_requestAccounts":
            return accounts();
          case "eth_chainId":
            return `0x${simChain.id.toString(16)}`;
          default:
            return simRpcRequest(method, params);
        }
      },
    };

    return {
      id: SIM_CONNECTOR_ID,
      name: "Simulation wallet",
      type: "simulation",

      async connect<withCapabilities extends boolean = false>(
        parameters?: { chainId?: number; isReconnecting?: boolean; withCapabilities?: withCapabilities | boolean }
      ) {
        const burner = getOrCreateBurner();
        const address = getAddress(burner.address);
        const list = parameters?.withCapabilities ? [{ address, capabilities: {} }] : [address];
        return {
          accounts: list as never,
          chainId: simChain.id,
        };
      },
      async disconnect() {
        config.emitter.emit("disconnect");
      },
      async getAccounts() {
        return accounts();
      },
      async getChainId() {
        return simChain.id;
      },
      async getProvider() {
        return provider;
      },
      async getClient() {
        const burner = getOrCreateBurner();
        return createWalletClient({ account: burner, chain: simChain, transport: simTransport });
      },
      async isAuthorized() {
        return getBurner() !== null && getSimRpcPath() !== null;
      },
      async switchChain({ chainId }) {
        if (chainId !== simChain.id) throw new Error("The simulation wallet only works on the simulation chain.");
        return simChain;
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {
        config.emitter.emit("disconnect");
      },
    };
  });
}

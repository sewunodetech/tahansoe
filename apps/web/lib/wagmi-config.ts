import { createConfig, http } from "wagmi";
import { arbitrum, arbitrumSepolia, base, mainnet, optimism } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { simChain } from "@/lib/sim/chain";
import { simConnector } from "@/lib/sim/connector";
import { simTransport } from "@/lib/sim/rpc";

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "demo";

export const wagmiConfig = createConfig({
  chains: [arbitrum, arbitrumSepolia, base, mainnet, optimism, simChain],
  connectors: [
    injected({ target: "metaMask" }),
    injected(), // catches any other injected wallet (Coinbase, Rabby, etc.)
    walletConnect({ projectId }),
    simConnector(), // Simulation Mode burner wallet, simulation chain only
  ],
  transports: {
    [arbitrum.id]: http(),
    [arbitrumSepolia.id]: http(),
    [mainnet.id]: http(),
    [base.id]: http(),
    [optimism.id]: http(),
    [simChain.id]: simTransport,
  },
  ssr: true,
});

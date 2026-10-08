import { createConfig, http } from "wagmi";
import { arbitrum, arbitrumSepolia, base, mainnet, optimism } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "demo";

export const wagmiConfig = createConfig({
  chains: [arbitrum, arbitrumSepolia, base, mainnet, optimism],
  connectors: [
    injected({ target: "metaMask" }),
    injected(), // catches any other injected wallet (Coinbase, Rabby, etc.)
    walletConnect({ projectId }),
  ],
  transports: {
    [arbitrum.id]: http(),
    [arbitrumSepolia.id]: http(),
    [mainnet.id]: http(),
    [base.id]: http(),
    [optimism.id]: http(),
  },
  ssr: true,
});

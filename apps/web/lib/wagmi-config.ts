import { createConfig, http } from "wagmi";
import { mainnet, base, arbitrum, optimism } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "demo";

export const wagmiConfig = createConfig({
  chains: [base, mainnet, arbitrum, optimism],
  connectors: [
    injected({ target: "metaMask" }),
    injected(), // catches any other injected wallet (Coinbase, Rabby, etc.)
    walletConnect({ projectId }),
  ],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
  },
  ssr: true,
});

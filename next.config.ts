import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The journey simulator is a separate Vite app (simulation/) built into public/simulation.
  rewrites: async () => [
    { source: "/simulation", destination: "/simulation/index.html" },
  ],
};

export default nextConfig;

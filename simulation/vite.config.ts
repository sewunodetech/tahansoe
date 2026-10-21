import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Served by the main Next.js app at /simulation: the build lands in its public/ folder
// and next.config.ts rewrites /simulation to the generated index.html.
export default defineConfig({
  base: "/simulation/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, ".."),
    },
  },
  build: {
    outDir: "../public/simulation",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});


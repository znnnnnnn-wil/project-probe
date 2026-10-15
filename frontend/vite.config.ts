import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { vadAssets } from "./vad-assets";
export default defineConfig({
  plugins: [react(), vadAssets()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": process.env.PROBE_API_TARGET || "http://127.0.0.1:8080" },
  },
});

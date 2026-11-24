import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { vadAssets } from "./vad-assets";
import { visionAssets } from "./vision-assets";
export default defineConfig({
  plugins: [react(), vadAssets(), visionAssets()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: { "/api": { target: process.env.PROBE_API_TARGET || "http://127.0.0.1:8180", ws: true } },
  },
});

import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    launchOptions: { channel: process.platform === "win32" ? "msedge" : undefined },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
  webServer: [
    {
      command: "node ../scripts/e2e-backend.mjs",
      url: "http://127.0.0.1:18082/api/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "npm run dev -- --port 5174",
      url: "http://localhost:5174",
      reuseExistingServer: false,
      env: { PROBE_API_TARGET: "http://127.0.0.1:18082" },
    },
  ],
});

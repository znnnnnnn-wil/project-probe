import { defineConfig } from "@playwright/test";
const external = process.env.PROBE_TEST_EXTERNAL_URL;
export default defineConfig({
  testDir: "./competition-tests",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: external || "http://localhost:5175",
    headless: true,
    launchOptions: {
      channel: process.platform === "win32" ? "msedge" : undefined,
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
  webServer: external
    ? []
    : [
        {
          command: "node ../scripts/e2e-backend.mjs",
          url: "http://127.0.0.1:18083/api/health",
          reuseExistingServer: false,
          timeout: 60000,
          env: {
            PROBE_TEST_PORT: "18083",
            PROBE_TEST_ORIGIN: "http://localhost:5175",
            PRACTICE_MAX_TURNS: "5",
          },
        },
        {
          command: "npm run dev -- --port 5175",
          url: "http://localhost:5175",
          reuseExistingServer: false,
          env: { PROBE_API_TARGET: "http://127.0.0.1:18083" },
        },
      ],
});

import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
// Explicitly authorized synthetic staging target. TLS verification remains enabled.
export default defineConfig({
  ...base,
  webServer: undefined,
  globalSetup: "./tests/server-setup.ts",
  use: { ...base.use, baseURL: "https://39.96.27.134" },
});

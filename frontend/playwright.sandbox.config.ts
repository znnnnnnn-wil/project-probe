import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./sandbox-tests",
  webServer: undefined,
  // 官方请求不录制 trace，避免留下临时支付签名、收银台令牌与 Cookie。
  use: { ...base.use, baseURL: "https://39.96.27.134", trace: "off" },
});

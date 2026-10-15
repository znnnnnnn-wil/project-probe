import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const origin = process.env.PROBE_E2E_ORIGIN;
if (!origin || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
  throw new Error("部署测试仅接受明确配置的本机隔离环境 PROBE_E2E_ORIGIN");
}
export default defineConfig({
  ...base,
  outputDir: "../.runtime/deployment-browser-results",
  webServer: undefined,
  use: { ...base.use, baseURL: origin },
});

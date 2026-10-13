import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(await readFile(path.join(root, ".runtime/live-model-1791865060526/result.json"), "utf8"));
if (source.status !== "PASSED" || !source.username.startsWith("live-synthetic-") || !source.deep.report) {
  throw new Error("仅允许使用已验收的合成模型报告生成产品预览");
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  await page.route("**/api/**", async route => {
    if (route.request().method() !== "GET") throw new Error("预览禁止写请求");
    const pathname = new URL(route.request().url()).pathname;
    const json = pathname === "/api/me" ? { id: "synthetic-preview", username: "合成体验" }
      : pathname === "/api/config" ? { modelMode: "live", modelName: source.model, paymentMode: "sandbox", paymentConfigured: true }
      : pathname === "/api/trainings/" + source.deep.id ? source.deep : null;
    if (!json) throw new Error("预览出现未预期接口");
    await route.fulfill({ json });
  });
  await page.goto("http://localhost:5175/#/report/" + source.deep.id);
  await page.locator(".finding").first().waitFor();
  await mkdir(path.join(root, "frontend/public"), { recursive: true });
  await page.locator(".finding").first().screenshot({ path: path.join(root, "frontend/public/report-example.png") });
  await writeFile(path.join(root, ".runtime/product-preview-source.json"), JSON.stringify({
    model: source.model, sourceDate: source.date, synthetic: true, newModelCalls: 0,
    asset: "frontend/public/report-example.png", notice: "先前真实模型合成输出的只读 UI 展示，不是新增模型或付款验证",
  }, null, 2));
  console.log("合成报告截图已生成；未发起模型、支付或数据库写请求。");
} finally { await browser.close(); }

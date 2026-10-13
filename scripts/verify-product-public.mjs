import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "https://39.96.27.134";
const result = JSON.parse(await readFile(path.join(root, ".runtime/live-model-1791865060526/result.json"), "utf8"));
if (result.status !== "PASSED" || !result.username.startsWith("live-synthetic-")) throw new Error("只允许合成验收数据");
const output = path.join(root, ".runtime/lifetime-price-9999-public-20261013");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [];
let catalog;
try {
  const api = await browser.newContext();
  try {
    const username = "public-products-" + crypto.randomUUID();
    const response = await api.request.post(base + "/api/auth/register", {
      headers: { Origin: base },
      data: { username, password: crypto.randomUUID() + crypto.randomUUID() },
    });
    if (!response.ok()) throw new Error("合成验收账号注册失败");
    const shopResponse = await api.request.get(base + "/api/shop");
    if (!shopResponse.ok()) throw new Error("线上商品接口读取失败");
    catalog = await shopResponse.json();
    const ten = catalog.products?.find(p => p.code === "TEN_TRAININGS");
    const permanent = catalog.products?.find(p => p.code === "LIFETIME");
    if (ten?.amountCents !== 990 || ten.trainingLimit !== 10 || ten.lifetime ||
        permanent?.amountCents !== 999900 || !permanent.lifetime || permanent.trainingLimit !== 0)
      throw new Error("线上套餐价格或权益错误");
    if (catalog.operationsEnabled || catalog.orders.length || catalog.packages.length) throw new Error("合成验收账户初始状态错误");
    await api.request.post(base + "/api/auth/logout", { headers: { Origin: base } });
  } finally { await api.close(); }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    let writes = 0;
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) writes++; });
    const config = await (await context.request.get(base + "/api/config")).json();
    if (config.modelMode !== "live" || config.paymentMode !== "sandbox" || config.modelName !== "deepseek-v4.1-flash") throw new Error("线上配置与预期不一致");
    const index = await context.request.get(base + "/");
    const localIndex = await readFile(path.join(root, "frontend/dist/index.html"));
    const hash = value => createHash("sha256").update(value).digest("hex");
    if (hash(await index.body()) !== hash(localIndex)) throw new Error("公网入口哈希不一致");
    const image = await context.request.get(base + "/report-example.png");
    if (!image.ok() || hash(await image.body()) !== hash(await readFile(path.join(root, "frontend/public/report-example.png")))) throw new Error("报告截图发布错误");
    await page.goto(base);
    await page.getByRole("heading", { name: "项目追问官", exact: true }).waitFor();
    await page.getByLabel("体验回答").fill("我会核对约束字段、冲突返回和并发测试输入。");
    await page.getByRole("button", { name: "查看复盘角度" }).click();
    await page.locator(".sample-feedback").waitFor();
    await page.locator(".sample-report-example").scrollIntoViewIfNeeded();
    if (!await page.locator(".sample-report-example img").evaluate(img => img.complete && img.naturalWidth === 872)) throw new Error("图片未正常加载");
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, "home-" + viewport.width + ".png"), fullPage: true });
    const deep = result.deep;
    const project = deep.project;
    const activeId = "00000000-0000-4000-8000-000000000001";
    const ongoing = { ...deep, id: activeId, status: "ACTIVE", report: undefined, turns: deep.turns.slice(0, 2).map((turn, index) => ({ ...turn, answer: index ? "" : turn.answer })) };
    const shop = { ...catalog, packages: [{ id: "synthetic-package", product_code: "TEN_TRAININGS", training_limit: 10, training_used: 2, lifetime: false, deep_used: false, retest_used: false }], quota: { unlimited: false, sharedRemaining: 8, legacyDeepRemaining: 0, legacyRetestRemaining: 0, deepAvailable: 8, retestAvailable: 8 } };
    await page.route("**/api/**", async route => {
      if (route.request().method() !== "GET") throw new Error("公网视觉验收禁止业务写请求");
      const url = new URL(route.request().url()).pathname;
      const data = url === "/api/config" ? config
        : url === "/api/me" ? { id: "synthetic-preview", username: "合成体验" }
        : url === "/api/projects" ? [project]
        : url === "/api/projects/" + project.id ? project
        : url === "/api/trainings" ? [ongoing, deep]
        : url === "/api/trainings/" + deep.id ? deep
        : url === "/api/trainings/" + activeId ? ongoing
        : url === "/api/shop" ? shop : null;
      if (!data) throw new Error("未预期的预览接口");
      await route.fulfill({ json: data });
    });
    await page.reload();
    const views = [["workspace", "/projects", ".workspace-stats"], ["editor", "/projects/" + project.id, ".editor-steps"], ["interview", "/trainings/" + activeId, ".question-panel"], ["report", "/report/" + deep.id, ".finding"], ["shop", "/shop", ".price"]];
    for (const [name, route, locator] of views) {
      await page.goto(base + "/#" + route);
      await page.locator(locator).first().waitFor();
      if (name === "editor") await page.getByRole("button", { name: "事实核对", exact: true }).click();
      if (name === "report") await page.locator(".plan-details summary").first().click();
      if (name === "shop") {
        const prices = await page.locator(".product-list .price").allTextContents();
        if (prices.length !== 2 || !prices[0].includes("9.90") || !prices[1].includes("9,999.00") || prices[1].includes("999,999.00"))
          throw new Error("永久套餐价格页面显示错误");
      }
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(name + " 横向溢出");
      await page.screenshot({ path: path.join(output, name + "-" + viewport.width + ".png"), fullPage: true });
    }
    await page.goto(base + "/payment-return");
    await page.getByRole("heading", { name: "未找到待核对订单" }).waitFor();
    await page.screenshot({ path: path.join(output, "return-" + viewport.width + ".png") });
    if (errors.length || writes) throw new Error(JSON.stringify({ errors, writes }));
    checks.push({ viewport, status: "PASSED", publicTlsVerified: true, staticHashesVerified: true, views: 7, businessApiFixtures: true, liveCatalogVerified: true, modelCalls: 0, paymentWrites: 0, userMaterialReads: 0 });
    await context.close();
  }
  await writeFile(path.join(output, "result.json"), JSON.stringify({ status: "PASSED", date: new Date().toISOString(), checks }, null, 2));
  console.log(JSON.stringify({ status: "PASSED", checks, output }));
} finally { await browser.close(); }

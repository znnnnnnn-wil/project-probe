import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".runtime/payment-checkout-acceptance");
await mkdir(output, { recursive: true });
const base = "https://39.96.27.134:18443";
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const hash = value => createHash("sha256").update(value).digest("hex");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const response = await context.request.get(base + "/");
      assert(response.ok() && hash(await response.body()) === hash(await readFile(path.join(root, "frontend/dist/index.html"))), "公网构建不一致");
      const config = await (await context.request.get(base + "/api/config")).json();
      assert(config.paymentMode === "sandbox" && config.modelMode === "live", "运行模式变化");
      const registered = await context.request.post(base + "/api/auth/register", { headers: { Origin: base }, data: { username: "payment-ui-synthetic-" + randomUUID(), password: randomUUID() + randomUUID() } });
      assert(registered.ok(), "合成账号注册失败");
      const order = { id: randomUUID(), mode: "sandbox", status: "PENDING", amount_cents: 990, product_code: "TEN_TRAININGS", product_name: "10 次训练套餐", created_at: Date.now(), can_operate: true, can_pay: true, query_status: "WAIT_BUYER_PAY" };
      const product = { name: "10 次训练套餐", code: "TEN_TRAININGS", amountCents: 990, trainingLimit: 10, lifetime: false };
      let creates = 0, checkouts = 0, providerNavigations = 0, unexpectedBusinessWrites = 0;
      const errors = [];
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      // Only registration/logout reach the real server; all payment responses are synthetic.
      await context.route("**/api/orders**", async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        if (pathname === "/api/orders" && request.method() === "POST") { creates++; await route.fulfill({ json: order }); }
        else if (pathname === "/api/orders/" + order.id + "/checkout") {
          checkouts++;
          await route.fulfill({ json: { formHtml: '<form method="post" action="https://openapi-sandbox.dl.alipaydev.com/gateway.do"><input type="hidden" name="biz_content" value="synthetic"><input type="hidden" name="sign" value="synthetic"></form>' } });
        } else if (pathname === "/api/orders/" + order.id || pathname === "/api/orders/" + order.id + "/sync") await route.fulfill({ json: order });
        else { unexpectedBusinessWrites++; await route.abort(); }
      });
      await context.route("**/api/shop", route => route.fulfill({ json: { mode: "sandbox", configured: true, operationsEnabled: false, product, products: [product], orders: creates ? [order] : [], packages: order.status === "PAID" ? [{ id: randomUUID(), order_id: order.id, product_code: "TEN_TRAININGS", training_limit: 10, training_used: 0 }] : [] } }));
      await context.route("https://openapi-sandbox.dl.alipaydev.com/gateway.do**", async route => {
        providerNavigations++;
        assert(route.request().method() === "POST", "未使用SDK POST表单");
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: "<p>合成收银台，仅用于界面验收</p>" });
      });
      await page.goto(base + "/#/shop");
      const opening = page.waitForEvent("popup");
      await page.getByRole("button", { name: "创建沙箱订单", exact: true }).click();
      const popup = await opening;
      await popup.getByText("合成收银台，仅用于界面验收").waitFor();
      assert(creates === 1 && checkouts === 1 && providerNavigations === 1, "创建/打开未保持单次调用");
      assert(page.url().endsWith("/#/shop"), "原项目页被替换");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "手机/桌面横向溢出");
      await page.screenshot({ path: path.join(output, `waiting-public-${width}.png`), fullPage: true });
      order.status = "PAID";
      await page.getByText("支付已确认，训练权益已到账。", { exact: true }).waitFor({ timeout: 12000 });
      for (let i = 0; i < 20 && !popup.isClosed(); i++) await page.waitForTimeout(100);
      assert(popup.isClosed(), "确认后未关闭收银台");
      await page.locator(".orders").getByText(/已确认，权益已发放/).waitFor();
      await page.screenshot({ path: path.join(output, `confirmed-public-${width}.png`), fullPage: true });
      assert(errors.length === 0 && unexpectedBusinessWrites === 0, "脚本错误或意外业务写入");
      await context.request.post(base + "/api/auth/logout", { headers: { Origin: base } });
      checks.push({ width, tlsVerified: true, automaticPopupVerified: true, originalPageRetained: true, syntheticConfirmedPaymentClosesPopup: true, scriptErrors: errors.length, creates, checkouts });
    } finally { await context.close(); }
  }
  const result = { status: "PASSED", checks, paymentResponsesAreSynthetic: true, realOrderOrEntitlementWrites: 0, officialGatewayRequests: 0, modelCalls: 0 };
  await writeFile(path.join(output, "public-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }

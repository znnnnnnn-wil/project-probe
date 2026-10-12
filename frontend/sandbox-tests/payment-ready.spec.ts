import { test, expect } from "@playwright/test";

test("公网官方沙箱准备：服务端价格、签名表单、无模拟入口，不提交付款", async ({ page }) => {
  const context = page.context().request;
  const config = await (await context.get("/api/config")).json();
  expect(config).toMatchObject({ modelMode: "demo", paymentMode: "sandbox", paymentConfigured: true });
  let gatewayRequests = 0;
  await page.route("https://openapi-sandbox.dl.alipaydev.com/**", async route => {
    gatewayRequests++;
    await route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "开始项目练习" }).click();
  await page.getByLabel("用户名", { exact: true }).fill("sandbox-check-" + Date.now());
  await page.getByLabel("密码", { exact: true }).fill("synthetic-test-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await expect(page.getByRole("heading", { name: "从一个真实项目开始" })).toBeVisible();
  await page.goto("/#/shop");
  await expect(page.getByRole("button", { name: "模拟支付成功" })).toHaveCount(0);
  const headers = { Origin: "https://39.96.27.134" };
  const created = await context.post("/api/orders", { headers, data: { requestKey: crypto.randomUUID(), amountCents: 1 } });
  expect(created.ok()).toBeTruthy();
  const order = await created.json();
  expect(order.amount_cents).toBe(990);
  const checkout = await context.post(`/api/orders/${order.id}/checkout`, { headers, data: {} });
  expect(checkout.ok()).toBeTruthy();
  const result = await checkout.json();
  const fields = await page.evaluate((html: string) => {
    const form = new DOMParser().parseFromString(html, "text/html").querySelector("form")!;
    const values = {
      ...Object.fromEntries(new URL(form.action).searchParams),
      ...Object.fromEntries(Array.from(form.querySelectorAll("input")).map(i => [i.name, i.value])),
    };
    const business = JSON.parse(values.biz_content);
    return { action: form.action, app: values.app_id, signed: !!values.sign, amount: business.total_amount, merchant: business.out_trade_no, notify: values.notify_url, returnUrl: values.return_url };
  }, result.formHtml);
  expect(new URL(fields.action).hostname).toBe("openapi-sandbox.dl.alipaydev.com");
  expect(fields.app).toBe("9021000169616473");
  expect(fields.amount).toBe("9.90");
  expect(fields.merchant).toBe(order.merchant_order_no);
  expect(fields.signed).toBe(true);
  expect(fields.notify).toBe("https://39.96.27.134/api/payments/notify");
  expect(fields.returnUrl).toContain("https://39.96.27.134/payment-return");
  // 实际查询官方沙箱；未提交收银台的订单应尚未创建交易，不能发放权益。
  const query = await context.post(`/api/orders/${order.id}/sync`, { headers, data: {} });
  expect(query.ok()).toBeTruthy();
  expect(await query.json()).toMatchObject({ status: "PENDING", query_status: "NOT_CREATED" });
  const mock = await context.post(`/api/orders/${order.id}/mock-pay`, { headers, data: {} });
  expect(mock.status()).toBe(404);
  await page.reload();
  await expect(page.getByRole("button", { name: "前往官方沙箱" })).toBeEnabled();
  expect(gatewayRequests).toBe(0);
  await page.screenshot({ path: "test-results/sandbox-ready.png", fullPage: true });
});

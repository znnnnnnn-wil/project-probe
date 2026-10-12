import { test, expect } from "@playwright/test";

// 人工沙箱付款前可选执行。仅复用合成账号的已有订单，不新建、不付款。
test("官方沙箱收银台能展示付款页面（外部平台检查）", async ({ page }) => {
  test.skip(process.env.PROBE_SANDBOX_CASHIER_CHECK !== "true", "默认不向官方收银台提交订单");
  const username = process.env.PROBE_SANDBOX_TEST_USER || "";
  const password = process.env.PROBE_SANDBOX_TEST_PASSWORD || "";
  expect(username.startsWith("sandbox-check-")).toBe(true);
  expect(password.length).toBeGreaterThanOrEqual(10);
  const config = await (await page.request.get("/api/config")).json();
  expect(config.paymentMode).toBe("sandbox");
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: "https://39.96.27.134" }, data: { username, password },
  });
  expect(login.ok()).toBe(true);
  await page.goto("/#/shop");
  await page.getByRole("button", { name: "前往官方沙箱" }).first().click();
  await page.waitForURL(url => url.hostname === "excashier-sandbox.dl.alipaydev.com");
  const body = page.locator("body");
  await expect(body).not.toContainText("Whitelabel Error Page");
  await expect(body).not.toContainText("USER_NOT_LOGIN");
  await expect(body).toContainText(/扫码|二维码/);
  // 不填写支付宝账号、支付密码，不点击任何确认付款按钮。
});

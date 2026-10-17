import { test, expect } from "@playwright/test";

test("保存恢复码后可找回账户，旧密码失效", async ({ page }) => {
  const username = "account-" + crypto.randomUUID();
  await page.goto("/#/login");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("synthetic-account-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await page.getByRole("link", { name: /· 账户/ }).click();
  await page.getByLabel("当前密码", { exact: true }).fill("synthetic-account-password");
  await page.getByLabel("问题描述").fill("合成反馈：希望保留更明确的训练指引。");
  await page.getByRole("button", { name: "保存反馈", exact: true }).click();
  await expect(page.getByText(/反馈已保存，编号/)).toBeVisible();
  await page.getByRole("button", { name: "生成或更换恢复码" }).click();
  const code = await page.locator("[role=status] code").innerText();
  expect(code.length).toBe(32);
  await Promise.all([
    page.waitForResponse("**/api/auth/logout"),
    page.getByRole("button", { name: "退出登录" }).click(),
  ]);
  await expect(page.getByRole("button", { name: "退出登录" })).toHaveCount(0);
  await page.goto("/#/login");
  await page.getByRole("button", { name: "已有账号？去登录" }).click();
  await page.getByRole("button", { name: "忘记密码？使用恢复码" }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("一次性恢复码").fill(code);
  await page.getByLabel("新密码").fill("synthetic-new-account-password");
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("密码已重置");
});

test("退出登录的迟到响应不会覆盖用户已打开的公开页面", async ({ page }) => {
  let entered = false;
  let release: () => void = () => {};
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") await route.fulfill({ json: { modelMode: "demo", paymentMode: "mock" } });
    else if (path === "/api/me") await route.fulfill({ json: { id: "synthetic", username: "导航回归" } });
    else if (path === "/api/auth/logout") {
      entered = true;
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: {} });
    } else throw Error(path);
  });
  await page.goto("/#/privacy");
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect.poll(() => entered).toBe(true);
  await page.evaluate(() => { location.hash = "/login"; });
  await expect(page).toHaveURL(/#\/login$/);
  await page.getByRole("link", { name: "隐私与服务说明", exact: true }).click();
  await expect(page.getByRole("heading", { name: "隐私与服务说明", exact: true })).toBeVisible();
  const response = page.waitForResponse("**/api/auth/logout");
  release(); await response;
  await expect(page.getByRole("button", { name: "退出登录" })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/privacy$/);
});

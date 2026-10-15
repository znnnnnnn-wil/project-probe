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
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.goto("/#/login");
  await page.getByRole("button", { name: "已有账号？去登录" }).click();
  await page.getByRole("button", { name: "忘记密码？使用恢复码" }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("一次性恢复码").fill(code);
  await page.getByLabel("新密码").fill("synthetic-new-account-password");
  await page.getByRole("button", { name: "重置密码", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("密码已重置");
});

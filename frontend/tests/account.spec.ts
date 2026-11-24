import { test, expect } from "@playwright/test";

test("同账号刷新保留草稿，登录切换和启动身份变化清理前一账号缓存", async ({ page }) => {
  let user = { id: "synthetic-a", username: "草稿账号A" };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path === "/api/me") json = user;
    else if (path === "/api/config") json = { modelMode: "demo" };
    else if (path === "/api/auth/login") json = user = { id: "synthetic-b", username: "草稿账号B" };
    else if (path === "/api/projects") json = [];
    else if (path === "/api/training-overview") json = { items: [], activeCount: 0, completedCount: 0 };
    else throw Error(path);
    await route.fulfill({ json });
  });
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/#/projects/new");
  await page.getByLabel("项目名称", { exact: true }).fill("账号A未保存的项目");
  await page.getByLabel("项目简介", { exact: true }).fill("账号A的私人材料");
  await page.reload();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("账号A未保存的项目");
  await page.evaluate(() => { location.hash = "/login"; });
  await page.getByRole("button", { name: "已有账号？去登录" }).click();
  await page.getByLabel("用户名", { exact: true }).fill("草稿账号B");
  await page.getByLabel("密码", { exact: true }).fill("synthetic-account-b-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("link", { name: "草稿账号B · 账户" })).toBeVisible();
  await page.evaluate(() => { location.hash = "/projects/new"; });
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("项目简介", { exact: true })).toHaveValue("");
  await page.getByLabel("项目名称", { exact: true }).fill("账号B私人项目");
  user = { id: "synthetic-a", username: "草稿账号A" };
  await page.reload();
  await expect(page.getByRole("link", { name: "草稿账号A · 账户" })).toBeVisible();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("");
  await page.evaluate(() => {
    sessionStorage.removeItem("auth:owner");
    sessionStorage.setItem("project-draft:new", JSON.stringify({ name: "无法确认归属的旧草稿", responsibility: "旧材料" }));
  });
  await page.reload();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("");
});

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
    if (path === "/api/config") await route.fulfill({ json: { modelMode: "demo" } });
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
  await page.evaluate(() => { location.hash = "/privacy"; });
  await expect(page.getByRole("heading", { name: "隐私与服务说明", exact: true })).toBeVisible();
  const response = page.waitForResponse("**/api/auth/logout");
  release(); await response;
  await expect(page.getByRole("button", { name: "退出登录" })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/privacy$/);
});

import { test, expect } from "@playwright/test";
import { trainingFixture } from "./training-fixture";

test("公开说明可访问，删除项目须确认且保留订单", async ({ page }) => {
  const { project } = await trainingFixture(page);
  await page.goto("/#/account");
  await page.getByRole("combobox", { name: /要删除的项目/ }).click();
  await page.getByRole("option", { name: project.name, exact: true }).click();
  await page.getByLabel("当前密码（用于数据清理）").fill("synthetic-password-123");
  const remove = page.getByRole("button", { name: "删除所选项目及训练内容" });
  await expect(remove).toBeDisabled();
  await page.getByLabel("确认文字").fill(project.name);
  page.once("dialog", d => d.accept());
  await remove.click();
  await expect(page.getByText(/项目材料、修订、问答、报告和草稿已删除/)).toBeVisible();
  expect((await page.request.get(`/api/projects/${project.id}`)).status()).toBe(404);
  const shop = await (await page.request.get("/api/shop")).json();
  expect(shop.orders).toHaveLength(1);
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("link", { name: "隐私与服务说明" }).click();
  await expect(page.getByRole("heading", { name: "隐私与服务说明" })).toBeVisible();
});

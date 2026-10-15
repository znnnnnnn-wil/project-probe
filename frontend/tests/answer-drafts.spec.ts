import { test, expect } from "@playwright/test";
import { trainingFixture } from "./training-fixture";

test("服务端草稿可跨标签页恢复，旧页面不覆盖新版本", async ({ page }) => {
  const { training } = await trainingFixture(page);
  await page.goto(`/#/trainings/${training.id}`);
  await expect(page.getByText("输入后自动保存草稿，保留30天。", { exact: true })).toBeVisible();
  const other = await page.context().newPage();
  await other.goto(`/#/trainings/${training.id}`);
  await expect(other.getByText("输入后自动保存草稿，保留30天。", { exact: true })).toBeVisible();
  await page.getByLabel("你的回答", { exact: true }).fill("跨设备合成草稿");
  await expect(page.getByText("草稿已同步到服务端，尚未提交。", { exact: true })).toBeVisible();
  await other.getByLabel("你的回答", { exact: true }).fill("旧页面草稿");
  await expect(other.getByText(/草稿已在其他设备更新/)).toBeVisible();
  const fresh = await page.context().newPage();
  await fresh.goto(`/#/trainings/${training.id}`);
  await expect(fresh.getByLabel("你的回答", { exact: true })).toHaveValue("跨设备合成草稿");
  await fresh.close(); await other.close();
});

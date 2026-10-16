import { test, expect } from "@playwright/test";
import { trainingFixture } from "./training-fixture";

test("澄清保留草稿和训练次数，不会可以显式提交后继续", async ({ page }) => {
  const { training } = await trainingFixture(page);
  await page.goto(`/#/trainings/${training.id}`);
  await page.getByLabel("你的回答", { exact: true }).fill("尚未提交的合成草稿");
  await page.getByText("暂时不会、澄清题意或反馈问题", { exact: true }).click();
  await page.getByRole("button", { name: "请解释题意" }).click();
  await expect(page.getByRole("heading", { name: /调整次数/ })).toBeVisible();
  await expect(page.getByLabel("你的回答", { exact: true })).toHaveValue("尚未提交的合成草稿");
  await page.getByRole("combobox", { name: /问题类型/ }).click();
  await page.getByRole("option", { name: "反馈重复或不准确的问题", exact: true }).click();
  await page.getByLabel("具体说明").fill("这道题需要更明确的条件");
  await page.getByRole("button", { name: "保存问题反馈" }).click();
  await expect(page.getByText("问题反馈已保存。", { exact: true })).toBeVisible();
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "暂时不会，记录后继续" }).click();
  await expect(page.locator(".question-label")).toContainText("02");
  const value = await (await page.request.get(`/api/trainings/${training.id}`)).json();
  expect(value.turns[0].answer).toContain("暂时不会");
  const shop = await (await page.request.get("/api/shop")).json();
  expect(shop.quota.sharedRemaining).toBe(9);
});

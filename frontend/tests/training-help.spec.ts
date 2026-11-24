import { test, expect } from "@playwright/test";
import { trainingFixture } from "./training-fixture";

test("其他标签页调整题目后旧回答被拒绝，刷新保留草稿并按新题提交", async ({ page }) => {
  const { training } = await trainingFixture(page);
  await page.goto(`/#/trainings/${training.id}`);
  await expect(page.getByText("输入后自动保存草稿，保留30天。", { exact: true })).toBeVisible();
  await page.getByLabel("你的回答", { exact: true }).fill("准备针对原题提交的草稿");
  await expect(page.getByText("草稿已同步到服务端，尚未提交。", { exact: true })).toBeVisible();
  const other = await page.context().newPage();
  try {
    await other.goto(`/#/trainings/${training.id}`);
    await other.getByText("暂时不会、澄清题意或反馈问题", { exact: true }).click();
    await other.getByRole("button", { name: "请解释题意" }).click();
    await expect(other.getByRole("heading", { name: /调整次数/ })).toBeVisible();
    const response = page.waitForResponse(r => r.url().endsWith(`/trainings/${training.id}/answer`));
    await page.getByRole("button", { name: "提交并继续", exact: true }).click();
    expect((await response).status()).toBe(409);
    await expect(page.getByRole("alert")).toContainText("题目已调整");
    await expect(page.getByLabel("你的回答", { exact: true })).toHaveValue("准备针对原题提交的草稿");
    const unchanged = await (await page.request.get(`/api/trainings/${training.id}`)).json();
    expect(unchanged.turns[0].answer).toBe("");
    expect(unchanged.turns[0].questionVersion).toBe(1);
    await page.reload();
    await expect(page.getByLabel("你的回答", { exact: true })).toHaveValue("准备针对原题提交的草稿");
    await page.getByLabel("你的回答", { exact: true }).fill("我已核对调整后的题目，并按新的题意回答。");
    await page.getByRole("button", { name: "提交并继续", exact: true }).click();
    await expect(page.locator(".question-label")).toContainText("02");
    const saved = await (await page.request.get(`/api/trainings/${training.id}`)).json();
    expect(saved.turns[0].answer).toBe("我已核对调整后的题目，并按新的题意回答。");
  } finally { await other.close(); }
});

test("澄清保留草稿，可提交暂时不会后继续下一题", async ({ page }) => {
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
  expect(value.turns[0].id).toBe(training.turns[0].id);
  expect(value.turns).toHaveLength(2);
});

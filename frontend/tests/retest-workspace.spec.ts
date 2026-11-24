import { test, expect } from "@playwright/test";
import { trainingFixture } from "./training-fixture";

test("笔记预览经确认保存后，可以直接选择主题复测", async ({ page }) => {
  const { project, training, post } = await trainingFixture(page);
  await post(`/trainings/${training.id}/answer`, { turnId: training.turns[0].id, answer: "接口由我实现，唯一约束由数据库保证。" });
  const report = await post(`/trainings/${training.id}/finish`);
  await post(`/trainings/${training.id}/plan`, { taskIndex: 0, note: "合成补充：唯一约束冲突返回409。", done: true, version: 0 });
  await page.goto(`/#/report/${training.id}`);
  const workspace = page.getByRole("region", { name: "复盘与专项复测" });
  await workspace.getByRole("checkbox").first().check();
  await workspace.getByRole("button", { name: "预览加入材料" }).click();
  await expect(workspace.getByLabel("加入后的材料预览")).toContainText("唯一约束冲突返回409");
  const before = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(before.materials).not.toContain("唯一约束冲突返回409");
  await workspace.getByRole("button", { name: "确认保存到项目材料" }).click();
  await expect(workspace.getByRole("status")).toContainText("补充已加入项目材料，可以直接开始复测");
  await workspace.getByRole("combobox", { name: /本轮复测主题/ }).click();
  await workspace.getByRole("option", { name: report.report.findings[0].topic, exact: true }).click();
  await expect(workspace.getByRole("button", { name: "开始所选主题复测" })).toBeEnabled();
  await workspace.getByRole("button", { name: "开始所选主题复测" }).click();
  await expect(page).toHaveURL(/#\/trainings\//);
  const retest = await (await page.request.get("/api/trainings/" + page.url().split("/").pop())).json();
  expect(retest.parentId).toBe(training.id);
  expect(retest.project.materials).toContain("唯一约束冲突返回409");
});

import { test, expect } from "@playwright/test";
import { trainingFixture } from "./training-fixture";
import { demoProject } from "../src/api";

test("公开说明可访问，确认后删除项目及训练内容", async ({ page }) => {
  const { project, training } = await trainingFixture(page);
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
  expect((await page.request.get(`/api/trainings/${training.id}`)).status()).toBe(404);
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.evaluate(() => { location.hash = "/privacy"; });
  await expect(page.getByRole("heading", { name: "隐私与服务说明" })).toBeVisible();
});

for (const width of [1440, 390]) test(`项目卡片删除需确认，取消不删除且不影响其他项目 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { project, training, post } = await trainingFixture(page);
  const other = await post("/projects", { ...demoProject, name: "保留的其他项目" });
  await page.goto("/#/projects");
  const card = page.locator(".project-row").filter({ has: page.getByRole("heading", { name: project.name, exact: true }) });
  const trigger = card.getByRole("button", { name: "删除项目", exact: true });
  const dialog = page.getByRole("dialog", { name: "删除项目", exact: true });
  const confirm = dialog.getByRole("button", { name: "永久删除项目", exact: true });
  await expect(card).toBeVisible();
  await page.evaluate(({ projectId, otherId, trainingId }) => {
    sessionStorage.setItem("project-draft:" + projectId, "待删除草稿");
    sessionStorage.setItem("practice-draft:" + projectId, "待删除回答");
    sessionStorage.setItem("draft:" + trainingId + ":turn-1.sync", "待删除同步状态");
    sessionStorage.setItem("plan-draft:" + trainingId + ":0", "待删除复盘笔记");
    sessionStorage.setItem("project-draft:" + otherId, "保留的草稿");
  }, { projectId: project.id, otherId: other.id, trainingId: training.id });
  await trigger.click();
  await expect(dialog).toContainText("无法恢复");
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await expect(confirm).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect((await page.request.get("/api/projects/" + project.id)).ok()).toBeTruthy();
  await trigger.click();
  await dialog.getByLabel("当前密码", { exact: true }).fill("synthetic-password-123");
  await dialog.getByLabel("输入完整项目名称以确认").fill("错误项目名");
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await trigger.click();
  await expect(dialog.getByLabel("当前密码", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("输入完整项目名称以确认")).toHaveValue("");
  await dialog.getByLabel("输入完整项目名称以确认").fill(project.name);
  await dialog.getByLabel("当前密码", { exact: true }).fill("incorrect-password");
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText("当前密码不正确");
  await expect(card).toHaveCount(1);
  await dialog.getByLabel("当前密码", { exact: true }).fill("synthetic-password-123");
  await page.screenshot({ path: test.info().outputPath(`project-delete-${width}.png`), fullPage: true });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let deletes = 0;
  await page.route("**/api/projects/" + project.id, async route => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletes++;
    expect(route.request().postDataJSON()).toEqual({ password: "synthetic-password-123", confirmation: project.name });
    await pending;
    await route.continue();
  });
  await confirm.click();
  await expect(dialog.getByRole("button", { name: "正在删除…" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(`已删除“${project.name}”`);
  await expect(card).toHaveCount(0);
  await expect(page.locator(".resume-row")).toHaveCount(0);
  await expect(page.getByLabel("搜索项目")).toBeFocused();
  expect(deletes).toBe(1);
  expect((await page.request.get("/api/projects/" + project.id)).status()).toBe(404);
  expect((await page.request.get("/api/trainings/" + training.id)).status()).toBe(404);
  expect((await page.request.get("/api/projects/" + other.id)).ok()).toBeTruthy();
  const saved = await page.evaluate(() => ({ ...sessionStorage }));
  expect(saved["project-draft:" + project.id]).toBeUndefined();
  expect(saved["practice-draft:" + project.id]).toBeUndefined();
  expect(saved["draft:" + training.id + ":turn-1.sync"]).toBeUndefined();
  expect(saved["plan-draft:" + training.id + ":0"]).toBeUndefined();
  expect(saved["project-draft:" + other.id]).toBe("保留的草稿");
  expect(saved["auth:owner"]).toBeTruthy();
  await page.reload();
  await expect(page.locator(".project-row")).toHaveCount(1);
  await expect(page.locator(".project-row")).toContainText(other.name);
  await page.getByRole("link", { name: "编辑材料", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(other.id + "$"));
  await page.goto("/#/projects");
  await page.getByLabel("搜索项目").fill(other.name);
  await page.getByRole("button", { name: "删除项目", exact: true }).click();
  await dialog.getByLabel("当前密码", { exact: true }).fill("synthetic-password-123");
  await dialog.getByLabel("输入完整项目名称以确认").fill(other.name);
  await confirm.click();
  await expect(page.getByRole("heading", { name: "准备你的第一个项目" })).toBeVisible();
  await page.getByRole("button", { name: "创建第一个项目" }).click();
  await expect(page).toHaveURL(/#\/projects\/new$/);
  expect(errors).toEqual([]);
});

test("项目删除遇到任务占用或服务错误时保留项目并可重试", async ({ page }) => {
  const { project } = await trainingFixture(page);
  await page.goto("/#/projects");
  const card = page.locator(".project-row");
  await card.getByRole("button", { name: "删除项目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除项目", exact: true });
  await dialog.getByLabel("当前密码", { exact: true }).fill("synthetic-password-123");
  await dialog.getByLabel("输入完整项目名称以确认").fill(project.name);
  let attempts = 0;
  await page.route("**/api/projects/" + project.id, route => {
    if (route.request().method() !== "DELETE") return route.continue();
    attempts++;
    return attempts < 3 ? route.fulfill({
      status: attempts === 1 ? 409 : 500, contentType: "application/json",
      body: JSON.stringify({ message: attempts === 1 ? "仍有生成或导入任务，请等待完成或恢复后再清理" : "服务暂时不可用，请重试" }),
    }) : route.continue();
  });
  const confirm = dialog.getByRole("button", { name: "永久删除项目", exact: true });
  for (const message of ["仍有生成或导入任务", "服务暂时不可用"]) {
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText(message);
    await expect(card).toHaveCount(1);
    await expect(dialog.getByLabel("输入完整项目名称以确认")).toHaveValue(project.name);
    expect((await page.request.get("/api/projects/" + project.id)).ok()).toBeTruthy();
  }
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "准备你的第一个项目" })).toBeVisible();
  expect(attempts).toBe(3);
});

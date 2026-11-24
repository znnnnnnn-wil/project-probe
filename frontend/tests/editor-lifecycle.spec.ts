import { test, expect } from "@playwright/test";
import { demoProject } from "../src/api";
import { mockHandsFree } from "./practice-voice-fixture";

test("离开项目页后开始训练的迟到响应不会抢回页面", async ({ page }) => {
  await mockHandsFree(page);
  const projectId = "22222222-2222-4222-8222-222222222222";
  const practicePath = "/api/projects/" + projectId + "/practice";
  let entered = false;
  let release: () => void = () => {};
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let json: unknown;
    if (path === "/api/config")
      json = { modelMode: "demo", speechEnabled: true };
    else if (path === "/api/me")
      json = { id: "synthetic", username: "页面生命周期回归" };
    else if (path === "/api/projects/" + projectId)
      json = {
        ...demoProject,
        id: projectId,
        factsConfirmed: true,
        version: 1,
      };
    else if (path === practicePath && request.method() === "GET")
      json = { status: "AVAILABLE", maxTurns: 5 };
    else if (path === practicePath && request.method() === "POST") {
      entered = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      json = {
        status: "ACTIVE",
        maxTurns: 5,
        turns: [{ id: "turn", question: "请介绍你的实现。", answer: "" }],
      };
    } else if (path === "/api/projects" || path === "/api/trainings" || path === "/api/practice-history") {
      json = [];
    } else if (path === "/api/training-overview") {
      json = { items: [] };
    } else if (path === "/api/training-projects") json = [];
    else if (path === "/api/training-page")
      json = { items: [], total: 0, hasMore: false, offset: 0, limit: 20 };
    else throw new Error("未预期请求：" + path);
    await route.fulfill({ json });
  });
  await page.goto("/#/projects/" + projectId + "?interview=1");
  await page.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect.poll(() => entered).toBe(true);
  await page.getByRole("button", { name: "返回项目列表", exact: true }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole("heading", { name: "我的项目", exact: true })).toBeVisible();
  await expect(page.locator("#project-materials, #project-practice, dialog.practice-room")).toHaveCount(0);
  await page.getByRole("link", { name: "训练记录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "训练记录", exact: true }),
  ).toBeVisible();
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === practicePath &&
      response.request().method() === "POST",
  );
  release();
  await response;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page).toHaveURL(/#\/history$/);
});

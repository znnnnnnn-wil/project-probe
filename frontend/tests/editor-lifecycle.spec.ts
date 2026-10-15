import { test, expect } from "@playwright/test";
import { demoProject } from "../src/api";

test("离开项目页后开始训练的迟到响应不会抢回页面", async ({ page }) => {
  const projectId = "22222222-2222-4222-8222-222222222222";
  let entered = false;
  let release: () => void = () => {};
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let json: unknown;
    if (path === "/api/config")
      json = {
        modelMode: "demo",
        paymentMode: "mock",
        paymentConfigured: true,
      };
    else if (path === "/api/me")
      json = { id: "synthetic", username: "页面生命周期回归" };
    else if (path === "/api/projects/" + projectId)
      json = {
        ...demoProject,
        id: projectId,
        factsConfirmed: true,
        version: 1,
      };
    else if (path === "/api/shop")
      json = {
        mode: "mock",
        orders: [],
        packages: [],
        quota: { deepAvailable: 10 },
      };
    else if (path === "/api/trainings" && request.method() === "GET") json = [];
    else if (path === "/api/trainings" && request.method() === "POST") {
      entered = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      json = { id: "new-training", status: "ACTIVE" };
    } else if (path === "/api/training-projects") json = [];
    else if (path === "/api/training-page")
      json = { items: [], total: 0, hasMore: false, offset: 0, limit: 20 };
    else throw new Error("未预期请求：" + path);
    await route.fulfill({ json });
  });
  await page.goto("/#/projects/" + projectId);
  await page.getByRole("button", { name: "开始项目深挖", exact: true }).click();
  await expect.poll(() => entered).toBe(true);
  await page.getByRole("link", { name: "训练记录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "训练记录", exact: true }),
  ).toBeVisible();
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/trainings" &&
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

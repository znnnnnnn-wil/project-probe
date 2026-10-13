import { test, expect } from "@playwright/test";
import { demoProject } from "../src/api";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`底部开始失败可见，取得权益后可继续 ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const headers = {
      Origin: new URL(test.info().project.use.baseURL!).origin,
    };
    const post = async (path: string, data: unknown = {}) => {
      const response = await page
        .context()
        .request.post("/api" + path, { headers, data });
      expect(response.ok()).toBeTruthy();
      return response.json();
    };
    await post("/auth/register", {
      username: "start-feedback-" + crypto.randomUUID(),
      password: "synthetic-test-password",
    });
    let project = await post("/projects", demoProject);
    project = await post("/projects/" + project.id + "/extract");
    await post("/projects/" + project.id + "/confirm", {
      version: project.version,
      facts: project.facts,
    });
    await page.goto("/#/projects/" + project.id);
    const start = page.getByRole("button", {
      name: "开始项目深挖",
      exact: true,
    });
    await expect(start).toBeEnabled();
    await start.scrollIntoViewIfNeeded();
    await start.click();
    const reason = "没有可用的深挖次数，请先获取训练包";
    await expect(page.getByRole("alert")).toContainText(reason);
    await expect(page.getByRole("alert")).toBeInViewport();
    await expect(page.locator(".start-block .action-error")).toHaveText(reason);
    await expect(start).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/start-feedback-${viewport.width}.png`,
    });
    const order = await post("/orders", { requestKey: crypto.randomUUID() });
    await post("/orders/" + order.id + "/mock-pay");
    await start.click();
    await expect(page).toHaveURL(/#\/trainings\/[a-f0-9-]+$/);
    await expect(page.getByText("问题 01", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

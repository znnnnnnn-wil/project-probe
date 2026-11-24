import { test, expect } from "@playwright/test";
import { demoProject } from "../src/api";
import { mockPracticeVoice } from "./practice-voice-fixture";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`练习首题请求失败时显示原因并可重试 ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockPracticeVoice(page, () => "合成语音回答");
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
    const project = await post("/projects", demoProject);
    const reason = "练习首题暂时无法生成，请重试";
    let attempts = 0;
    await page.route(`**/api/projects/${project.id}/practice`, (route) => {
      if (route.request().method() === "POST" && ++attempts === 1) {
        return route.fulfill({ status: 503, json: { message: reason } });
      }
      return route.continue();
    });
    await page.goto("/#/projects/" + project.id + "?interview=1");
    const practice = page.getByRole("dialog", { name: "项目面试室" });
    const start = practice.getByRole("button", {
      name: "同意并开始语音面试",
      exact: true,
    });
    await expect(start).toBeEnabled();
    await start.scrollIntoViewIfNeeded();
    await start.click();
    const error = practice.getByRole("alert");
    await expect(error).toHaveText(reason);
    await expect(error).toBeInViewport();
    const retry = practice.getByRole("button", { name: "重试或恢复训练" });
    await expect(retry).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/start-feedback-${viewport.width}.png`,
    });
    await retry.click();
    await expect(practice.getByText(/^第 1 \/ \d+ 题$/)).toBeVisible();
    await expect(error).toHaveCount(0);
    expect(attempts).toBe(2);
  });
}

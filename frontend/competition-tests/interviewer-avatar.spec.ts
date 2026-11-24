import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill(path === "/api/config" ? { json: { modelMode: "demo" } }
      : path === "/api/me" ? { json: null } : { status: 503, json: { message: "测试不调用后端" } });
  });
  await page.addInitScript(() => {
    Object.defineProperties(speechSynthesis, {
      getVoices: { value: () => [] }, cancel: { value: () => {} },
      speak: { value: (utterance: SpeechSynthesisUtterance) => {
        utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
        queueMicrotask(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent));
      } },
    });
  });
});

async function ready(page: Page) {
  await expect(page.locator(".avatar-mount")).toHaveCSS("opacity", "1", { timeout: 30000 });
  await expect(page.locator(".avatar-mount canvas")).toHaveCount(1);
  await expect(page.locator(".avatar-mount canvas")).toBeVisible();
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}px 人物加载及进出面试室只保留一个画布`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const model = page.waitForResponse(response => response.url().endsWith("/models/interviewer-v2.glb"));
    await page.goto("/#/login");
    expect((await model).ok()).toBe(true);
    await ready(page);
    await fits(page);
    await page.evaluate(() => sessionStorage.setItem("project-probe:experience:v1", JSON.stringify({
      version: 1, sample: "booking", started: true, answers: [], draft: "",
      notes: Array(5).fill(""), checked: Array(5).fill(false),
    })));
    await page.goto("/#/experience?mode=legacy");
    await page.getByRole("button", { name: "进入面试室", exact: true }).click();
    const room = page.getByRole("dialog", { name: "示例面试室" });
    await expect(room).toBeVisible();
    await ready(page);
    const answer = page.getByLabel("本轮回答", { exact: true });
    await answer.fill("我负责预约接口，仍需验证并发。");
    for (let cycle = 0; cycle < 2; cycle++) {
      if (cycle > 0)
        await page.getByRole("button", { name: "进入面试室", exact: true }).click();
      await expect(room).toBeVisible();
      await expect(page.locator("canvas")).toHaveCount(1);
      await expect(room.locator("canvas")).toHaveCount(1);
      await fits(page);
      await room.getByRole("button", { name: "返回练习", exact: true }).click();
      await expect(room).not.toBeVisible();
      await ready(page);
      await expect(answer).toHaveValue("我负责预约接口，仍需验证并发。");
    }
    await page.goto("/#/login");
    await ready(page);
    await fits(page);
    expect(errors).toEqual([]);
  });
}

test("减少动态效果时人物保持静止", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/login");
  await ready(page);
  const canvas = page.locator(".avatar-mount canvas");
  const first = await canvas.screenshot();
  await page.waitForTimeout(500);
  expect(await canvas.screenshot()).toEqual(first);
});

for (const failure of ["model", "webgl"] as const) {
  test(`${failure} 不可用时显示肖像且登录表单仍可操作`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (failure === "model") {
      await page.route("**/models/interviewer-v2.glb", route => route.abort("failed"));
    } else {
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
          return /webgl/i.test(type) ? null : Reflect.apply(original, this, [type, ...args]);
        } as typeof original;
      });
    }
    await page.goto("/#/login");
    const portrait = page.locator(".avatar-portrait");
    await expect(portrait).toBeVisible();
    await expect(page.getByText("正在准备 3D 面试官", { exact: true })).toHaveCount(0);
    await expect(portrait).toHaveCSS("opacity", "1");
    await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator(".avatar-mount canvas")).toHaveCount(0);
    await page.getByLabel("用户名", { exact: true }).fill("avatar-fallback");
    await page.getByLabel("密码", { exact: true }).fill("synthetic-password");
    await expect(page.getByRole("button", { name: "注册并开始", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "已有账号？去登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "欢迎回来", exact: true })).toBeVisible();
    await expect(page.getByLabel("用户名", { exact: true })).toHaveValue("avatar-fallback");
    await fits(page);
  });
}

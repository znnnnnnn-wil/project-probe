import { test, expect } from "@playwright/test";
import { demoProject } from "../src/api";

for (const width of [1440, 390]) {
  test(`训练选择器支持鼠标、键盘与正确提交 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const id = "22222222-2222-4222-8222-222222222222";
    let submitted: Record<string, unknown> | undefined;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let json;
      if (path === "/api/config")
        json = { modelMode: "demo", paymentMode: "mock" };
      else if (path === "/api/me")
        json = { id: "synthetic", username: "选择器验收" };
      else if (path === "/api/projects/" + id)
        json = { ...demoProject, id, version: 1, factsConfirmed: true };
      else if (path === "/api/projects/" + id + "/practice")
        json = { status: "USED" };
      else if (path === "/api/shop")
        json = {
          mode: "mock",
          orders: [],
          packages: [],
          quota: { deepAvailable: 10 },
        };
      else if (path === "/api/trainings") {
        if (route.request().method() === "POST") {
          submitted = route.request().postDataJSON();
          await route.fulfill({
            status: 409,
            json: { message: "合成验收，不创建训练" },
          });
          return;
        }
        json = [];
      } else throw Error("未预期接口：" + path);
      await route.fulfill({ json });
    });
    await page.goto("/#/projects/" + id);
    const length = page.getByRole("combobox", { name: /练习长度/ });
    const focus = page.getByRole("combobox", { name: /追问侧重/ });
    await expect(length).toBeEnabled();
    await length.click();
    await expect(
      page.getByRole("listbox", { name: "练习长度", exact: true }),
    ).toBeVisible();
    await length.press("Home");
    await length.press("Enter");
    await expect(length).toContainText("快速练习");
    await length.press("End");
    await length.press("Escape");
    await expect(length).toContainText("快速练习");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await length.click();
    await page
      .getByRole("heading", { name: demoProject.name, exact: true })
      .click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await length.focus();
    await length.press("ArrowDown");
    await length.press("Tab");
    await expect(focus).toBeFocused();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await focus.click();
    await page
      .getByRole("option", { name: "故障与方案取舍", exact: true })
      .click();
    await expect(focus).toContainText("故障与方案取舍");
    await expect(focus).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "开始项目深挖", exact: true })
      .click();
    await expect.poll(() => submitted?.exerciseMode).toBe("QUICK");
    expect(submitted?.difficulty).toBe("TRADEOFF");
    await expect(
      page.getByText("合成验收，不创建训练", { exact: true }).first(),
    ).toBeVisible();
  });
}

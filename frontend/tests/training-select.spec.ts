import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`训练选择器支持鼠标、键盘与正确提交 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const id = "22222222-2222-4222-8222-222222222222";
    let selected = "";
    await page.route("**/api/**", async (route) => {
      const requestUrl = new URL(route.request().url());
      const path = requestUrl.pathname;
      let json;
      if (path === "/api/config")
        json = { modelMode: "demo" };
      else if (path === "/api/me")
        json = { id: "synthetic", username: "选择器验收" };
      else if (path === "/api/training-projects")
        json = [{ key: id, name: "预约系统" }];
      else if (path === "/api/practice-history" || path === "/api/examples/practice-history")
        json = [];
      else if (path === "/api/training-page") {
        selected = requestUrl.searchParams.get("key") || "";
        json = { items: [], total: 0, hasMore: false };
      } else throw Error("未预期接口：" + path);
      await route.fulfill({ json });
    });
    await page.goto("/#/history");
    const filter = page.getByRole("combobox", { name: "筛选训练项目" });
    await expect(filter).toBeEnabled();
    await filter.click();
    await expect(
      page.getByRole("listbox", { name: "筛选训练项目", exact: true }),
    ).toBeVisible();
    await filter.press("End");
    await filter.press("Enter");
    await expect(filter).toContainText("预约系统");
    await expect.poll(() => selected).toBe(id);
    await filter.press("Home");
    await filter.press("Escape");
    await expect(filter).toContainText("预约系统");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await filter.click();
    await page
      .getByRole("heading", { name: "训练记录", exact: true })
      .click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await filter.click();
    await page
      .getByRole("option", { name: "全部项目", exact: true })
      .click();
    await expect(filter).toBeFocused();
    await expect.poll(() => selected).toBe("");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

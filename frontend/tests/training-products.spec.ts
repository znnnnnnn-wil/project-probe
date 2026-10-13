import { test, expect } from "@playwright/test";
import { demoProject } from "../src/api";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`双套餐定价、共享余额与永久权益 ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
      username: "products-" + crypto.randomUUID(),
      password: "synthetic-test-password",
    });
    await page.goto("/#/shop");
    const normal = page
      .locator(".package-card")
      .filter({
        has: page.getByRole("heading", { name: "10 次训练套餐", exact: true }),
      });
    const lifetime = page
      .locator(".package-card")
      .filter({
        has: page.getByRole("heading", { name: "永久训练套餐", exact: true }),
      });
    await expect(normal.locator(".price")).toContainText("9.90");
    await expect(normal).toContainText("深挖与复测合计 10 次");
    await expect(lifetime.locator(".price")).toContainText("9,999.00");
    await page.screenshot({
      path: `test-results/products-${viewport.width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    let dialogText = "";
    page.once("dialog", async (dialog) => {
      dialogText = dialog.message();
      await dialog.dismiss();
    });
    await lifetime
      .getByRole("button", { name: "创建永久套餐模拟订单", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "模拟支付成功" }),
    ).toHaveCount(0);
    expect(dialogText).toContain("9,999");
    await normal
      .getByRole("button", { name: "创建模拟订单", exact: true })
      .click();
    await page
      .getByRole("button", { name: "模拟支付成功", exact: true })
      .click();
    await expect(page.locator(".balance")).toContainText("10");
    let project = await post("/projects", demoProject);
    project = await post("/projects/" + project.id + "/extract");
    await post("/projects/" + project.id + "/confirm", {
      version: project.version,
      facts: project.facts,
    });
    const deep = await post("/trainings", {
      projectId: project.id,
      requestKey: crypto.randomUUID(),
    });
    const turn = deep.turns[0];
    await post("/trainings/" + deep.id + "/answer", {
      turnId: turn.id,
      answer: "我负责接口和数据库约束，并发验证需要补充测试输入与断言。",
    });
    await post("/trainings/" + deep.id + "/finish");
    await post("/trainings", {
      projectId: project.id,
      parentId: deep.id,
      requestKey: crypto.randomUUID(),
    });
    await page.reload();
    const after = await (await page.context().request.get("/api/shop")).json();
    expect(after.quota.sharedRemaining).toBe(8);
    await expect(page.locator(".balance strong").first()).toHaveText("8");
    page.once("dialog", (dialog) => dialog.accept());
    await lifetime
      .getByRole("button", { name: "创建永久套餐模拟订单", exact: true })
      .click();
    await page
      .getByRole("button", { name: "模拟支付成功", exact: true })
      .click();
    await expect(page.locator(".balance")).toContainText("不限次数");
    const shop = await (await page.context().request.get("/api/shop")).json();
    expect(shop.quota.unlimited).toBe(true);
    expect(
      shop.orders.find(
        (o: { product_code: string }) => o.product_code === "LIFETIME",
      ).amount_cents,
    ).toBe(999900);
    await page.goto("/#/projects/" + project.id);
    await expect(page.locator(".readiness-list")).toContainText(
      "永久套餐 · 不限次数",
    );
    expect(errors).toEqual([]);
  });
}

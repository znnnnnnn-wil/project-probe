import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) test(`运营工作台查看及回复反馈 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const row = { id: "22222222-2222-4222-8222-222222222222", kind: "GENERAL", body: "合成反馈：请明确下一步操作", request_id: "33333333-3333-4333-8333-333333333333", status: "OPEN", reply: "" };
  let updated = false;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === "/api/config") json = { modelMode: "demo", paymentMode: "mock" };
    else if (path === "/api/me") json = { id: "synthetic", username: "运营验收" };
    else if (path === "/api/account/access") json = { operator: true, userId: "synthetic" };
    else if (path === "/api/operator/metrics") json = {
      journey: { paymentMode: "mock", stages: [{ event: "TRIAL_COMPLETED", users: 1, events: 1 }], note: "合成阶段数据，不代表真实用户" },
      modelAttempts: [{ payment_mode: "mock", model_name: "synthetic", outcome: "FAILED", attempts: 1, mean_ms: 1500 }], textCosts: [], costNote: "费用未知",
    };
    else if (path === "/api/operator/feedback-page") json = { items: updated ? [] : [row], total: updated ? 0 : 1, hasMore: false };
    else if (path === "/api/operator/feedback/" + row.id) {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ expectedReply: "", expectedStatus: "OPEN", status: "RESOLVED", reply: "已核查合成反馈" });
      updated = true; json = {};
    } else throw Error(path);
    await route.fulfill({ json });
  });
  await page.goto("/#/operator");
  await expect(page.getByRole("heading", { name: "服务与反馈工作台" })).toBeVisible();
  await expect(page.getByText("合成反馈：请明确下一步操作")).toBeVisible();
  await page.getByRole("button", { name: "处理这条反馈" }).click();
  await page.getByLabel("站内处理回复").fill("已核查合成反馈");
  await page.getByRole("button", { name: "保存回复并标记已处理" }).click();
  await expect(page.getByRole("heading", { name: "站内反馈 · 0 条" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("普通账号进入运营页面不请求全站数据", async ({ page }) => {
  let operatorReads = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/operator/")) operatorReads++;
    await route.fulfill({ json: path === "/api/config" ? { modelMode: "demo", paymentMode: "mock" } : path === "/api/me" ? { id: "synthetic", username: "普通账号" } : { operator: false } });
  });
  await page.goto("/#/operator");
  await expect(page.getByRole("alert")).toContainText("此账号没有运营权限");
  expect(operatorReads).toBe(0);
});

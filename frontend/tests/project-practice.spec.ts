import { test, expect } from "@playwright/test";

test("新用户只填必要材料即可一题体验，无订单和权益消费", async ({ page }) => {
  await page.goto("/#/login");
  await page.getByLabel("用户名", { exact: true }).fill("trial-" + crypto.randomUUID());
  await page.getByLabel("密码", { exact: true }).fill("synthetic-trial-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await page.goto("/#/projects/new");
  await page.getByLabel("项目名称", { exact: true }).fill("合成试练项目");
  await page.getByLabel("个人职责（必填）", { exact: true }).fill("我实现预约接口和数据库唯一约束。");
  await page.getByRole("button", { name: "保存项目材料", exact: true }).click();
  const trial = page.getByRole("region", { name: "我的项目一题体验" });
  await trial.getByRole("button", { name: "开始一题体验", exact: true }).click();
  await expect(trial.getByRole("heading", { name: /请介绍/ })).toBeVisible();
  await trial.getByLabel("体验回答").fill("我负责接口，数据库唯一约束防止重复预约。");
  await trial.getByRole("button", { name: "提交体验回答" }).click();
  await expect(trial.getByRole("heading", { name: "针对你的回答" })).toBeVisible();
  expect((await (await page.request.get("/api/shop")).json()).orders).toHaveLength(0);
  await page.reload();
  await expect(trial.getByRole("heading", { name: "针对你的回答" })).toBeVisible();
});

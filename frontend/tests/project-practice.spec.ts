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
  const projectId = page.url().split("/").pop()!;
  const original = await (await page.request.get("/api/projects/" + projectId)).json();
  await trial.getByRole("button", { name: "预览回答补充到材料" }).click();
  await expect(trial.getByLabel("项目材料补充预览")).toContainText("我负责接口");
  expect((await (await page.request.get("/api/projects/" + projectId)).json()).version).toBe(original.version);
  await trial.getByRole("button", { name: "确认保存回答补充" }).click();
  const saved = await (await page.request.get("/api/projects/" + projectId)).json();
  expect(saved.materials).toContain("用户自述，未独立验证");
  expect(saved.version).toBe(original.version + 1);
  expect(saved.factsConfirmed).toBe(false);
  await trial.getByRole("button", { name: "预览回答补充到材料" }).click();
  await expect(trial.getByText("这段回答已在项目材料中，无需重复加入。")).toBeVisible();
  await trial.getByRole("button", { name: "前往事实核对", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目事实清单" })).toBeVisible();
  const review = page.getByRole("region", { name: "自愿体验反馈" });
  await review.getByRole("button", { name: "4分", exact: true }).click();
  await review.getByRole("button", { name: "愿意继续", exact: true }).click();
  await review.getByLabel("最卡住的一步（可选）").fill("合成调研：需要明确下一步。");
  await review.getByRole("button", { name: "保存体验反馈" }).click();
  await expect(review.getByRole("status")).toContainText("已记录这次体验反馈");
  const feedback = await (await page.request.get("/api/feedback")).json();
  expect(feedback.filter((item: { body: string }) => item.body.includes("非付费记录"))).toHaveLength(1);
  expect((await (await page.request.get("/api/shop")).json()).orders).toHaveLength(0);
  await page.reload();
  await expect(trial.getByRole("heading", { name: "针对你的回答" })).toBeVisible();
});

test("体验草稿刷新与返回后保留，读取失败必须显式重试", async ({ page }) => {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api" + path, { headers: { Origin: origin }, data });
    expect(r.ok()).toBeTruthy(); return r.json();
  };
  await post("/auth/register", { username: "draft-trial-" + crypto.randomUUID(), password: "synthetic-trial-password" });
  const p = await post("/projects", { name: "草稿体验", responsibility: "预约接口" });
  const active = await post(`/projects/${p.id}/practice`, {});
  await page.goto(`/#/projects/${p.id}`);
  const trial = page.getByRole("region", { name: "我的项目一题体验" });
  await trial.getByLabel("体验回答").fill("未提交的合成回答：数据库唯一约束。");
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(trial.getByLabel("体验回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
  await page.goto("/#/account");
  await page.goto(`/#/projects/${p.id}`);
  await expect(trial.getByLabel("体验回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
  let failed = true, writes = 0;
  await page.route(`**/api/projects/${p.id}/practice`, async route => {
    if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
    if (failed) await route.fulfill({ status: 503, json: { message: "合成状态读取失败" } });
    else await route.fulfill({ json: active });
  });
  await page.reload();
  await expect(trial.getByRole("alert")).toContainText("合成状态读取失败");
  await expect(trial.getByRole("button", { name: "开始一题体验", exact: true })).toHaveCount(0);
  failed = false;
  await trial.getByRole("button", { name: "重新读取体验状态" }).click();
  await expect(trial.getByLabel("体验回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
  expect(writes).toBe(0);
});

test("刷新遇到正在生成只轮询读取，不重复提交", async ({ page }) => {
  const id = "22222222-2222-4222-8222-222222222222";
  let reads = 0, writes = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === "/api/config") json = { modelMode: "demo", paymentMode: "mock" };
    else if (path === "/api/me") json = { id: "synthetic", username: "生成恢复" };
    else if (path === "/api/projects/" + id) json = { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] };
    else if (path.endsWith("/practice")) {
      if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
      reads++;
      json = reads === 1 ? { status: "GENERATING" } : { status: "ACTIVE", turns: [{ id: "turn", question: "请说明预约流程。", answer: "" }] };
    } else if (path === "/api/trainings") json = [];
    else if (path === "/api/shop") json = { orders: [], packages: [] };
    else throw Error(path);
    await route.fulfill({ json });
  });
  await page.goto(`/#/projects/${id}`);
  await expect(page.getByRole("button", { name: "正在生成，自动恢复进度…" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "请说明预约流程。" })).toBeVisible();
  expect(reads).toBeGreaterThan(1); expect(writes).toBe(0);
});

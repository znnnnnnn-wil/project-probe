import { test, expect } from "@playwright/test";

test("桌面完整闭环：档案、事实、模拟权益、训练、刷新、报告及复测", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /项目是你做的/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "开始项目练习" }).click();
  await page.getByLabel("用户名", { exact: true }).fill("e2e-" + Date.now());
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-test-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await expect(
    page.getByRole("heading", { name: "从一个真实项目开始" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("button", { name: "载入合成示例" }).click();
  await page.getByRole("button", { name: "保存项目材料" }).click();
  await expect(
    page.getByRole("button", { name: "提取项目事实" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "提取项目事实" }).click();
  await expect(
    page.getByRole("button", { name: "保存核对结果" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存核对结果" }).click();
  await expect(
    page.getByRole("button", { name: "开始项目深挖" }),
  ).toBeEnabled();
  const savedResponse = page.waitForResponse(
    (r) => r.request().method() === "PUT" && /\/api\/projects\//.test(r.url()),
  );
  await page.getByRole("button", { name: "保存项目材料" }).click();
  const unchanged = await (await savedResponse).json();
  expect(unchanged.factsConfirmed).toBe(true);
  const extractedResponse = page.waitForResponse((r) =>
    r.url().endsWith("/extract"),
  );
  await page.getByRole("button", { name: "读取已提取事实" }).click();
  const reused = await (await extractedResponse).json();
  expect(reused.version).toBe(unchanged.version);
  expect(reused.factsConfirmed).toBe(true);
  await expect(
    page.getByRole("button", { name: "开始项目深挖" }),
  ).toBeEnabled();
  const projectUrl = page.url();
  await page.getByRole("link", { name: "查看训练包与剩余次数" }).click();
  await page.getByRole("button", { name: "创建模拟订单" }).click();
  await page.getByRole("button", { name: "模拟支付成功" }).click();
  await expect(
    page.getByText("已确认，权益已发放", { exact: false }),
  ).toBeVisible();
  await page.goto(projectUrl);
  await page.getByRole("button", { name: "开始项目深挖" }).click();
  await expect(page.getByText("问题 01", { exact: true })).toBeVisible();
  for (let i = 0; i < 5; i++) {
    const answer =
      "我负责预约创建接口。通过数据库唯一约束防止同一座位同一时段重复占用。冲突事务回滚并返回可解释的冲突结果。我用两个并发请求验证只有一个预约成功。第 " +
      i +
      " 轮补充。";
    await page.getByLabel("你的回答", { exact: true }).fill(answer);
    if (i === 0) {
      await page.reload();
      await expect(page.getByLabel("你的回答", { exact: true })).toHaveValue(
        answer,
      );
    }
    await page.getByRole("button", { name: "提交并继续" }).click();
    if (i < 4)
      await expect(
        page.getByText("问题 " + String(i + 2).padStart(2, "0"), {
          exact: true,
        }),
      ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "看清薄弱点，再往前一步。" }),
  ).toBeVisible();
  await expect(page.locator(".finding")).toHaveCount(5);
  await expect(page.locator("blockquote").first()).toContainText(
    "数据库唯一约束",
  );
  await page.screenshot({
    path: "test-results/report-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".finding")).toHaveCount(5);
  await page.getByRole("button", { name: "补充材料并复测" }).click();
  await page
    .getByLabel("验证方式", { exact: true })
    .fill(
      "补充合成测试设计：双实例并发预约，检查数据库约束冲突；在响应前断网重试，验证不会重复写入。实际压测数据尚未提供。",
    );
  await page.getByRole("button", { name: "保存项目材料" }).click();
  await page.getByRole("button", { name: "提取项目事实" }).click();
  await page.getByRole("button", { name: "保存核对结果" }).click();
  await page.getByRole("button", { name: "开始关联复测" }).click();
  await expect(page.getByText("问题 01", { exact: true })).toBeVisible();
  await expect(page.locator(".question-panel")).toContainText("交接");
  const retestUrl = page.url();
  await page.goto(projectUrl);
  await expect(
    page.getByRole("button", { name: "继续复测", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "开始关联复测", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "继续复测", exact: true }).click();
  await expect(page).toHaveURL(retestUrl);
  for (let i = 0; i < 3; i++) {
    await page
      .getByLabel("你的回答", { exact: true })
      .fill(
        "双实例共享数据库唯一约束；为重试使用业务幂等键，测试响应丢失后再次请求不会新增预约。还需要确认取消预约的约束实现。",
      );
    await page.getByRole("button", { name: "提交并继续" }).click();
    if (i < 2)
      await expect(
        page.getByText("问题 " + String(i + 2).padStart(2, "0"), {
          exact: true,
        }),
      ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "前后回答对照" }),
  ).toBeVisible();
  await expect(page.locator(".comparison")).toContainText(
    "双实例共享数据库唯一约束",
  );
  expect(errors).toEqual([]);
  const resultUrl = page.url();
  await page.goto(projectUrl);
  await expect(
    page.getByRole("button", { name: "查看复测结果", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "开始关联复测", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "查看复测结果", exact: true }).click();
  await expect(page).toHaveURL(resultUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/report-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("手机首页无横向溢出，导航可展开", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "切换导航" }).click();
  await expect(
    page.getByRole("link", { name: "我的项目", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
});

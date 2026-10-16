import { test, expect, type Page } from "@playwright/test";
import { demoProject } from "../src/api";

async function seed(page: Page) {
  const headers = { Origin: new URL(test.info().project.use.baseURL!).origin };
  const post = async (path: string, data: unknown = {}) => {
    const response = await page
      .context()
      .request.post("/api" + path, { headers, data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  await post("/auth/register", {
    username: "workspace-" + crypto.randomUUID(),
    password: "synthetic-test-password",
  });
  let project = await post("/projects", demoProject);
  project = await post("/projects/" + project.id + "/extract");
  project = await post("/projects/" + project.id + "/confirm", {
    version: project.version,
    facts: project.facts,
  });
  return { project, post };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`工作台、材料草稿、来源购买与复盘持久化 ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const { project, post } = await seed(page);
    await page.goto("/#/projects");
    await expect(
      page.getByRole("heading", { name: "我的项目", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".workspace-stats")).toContainText("可用深挖");
    await page.getByLabel("搜索项目").fill("不存在的项目");
    await expect(
      page.getByRole("heading", { name: "没有匹配的项目" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(page.locator(".project-row")).toHaveCount(1);
    await page.screenshot({
      path: `test-results/workspace-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "进入项目", exact: true }).click();
    await page.getByRole("button", { name: "展开技术栈、实现与验证等补充材料" }).click();
    await page
      .getByLabel("验证方式", { exact: true })
      .fill("未保存的合成验证笔记");
    page.on("dialog", (dialog) => dialog.accept());
    await page.reload();
    await expect(page.getByLabel("验证方式", { exact: true })).toHaveValue(
      "未保存的合成验证笔记",
    );
    await expect(page.getByRole("status")).toContainText(
      "已恢复此标签页未保存的材料",
    );
    await page.getByRole("button", { name: "保存项目材料" }).click();
    await page.getByRole("button", { name: "事实核对", exact: true }).click();
    await page
      .getByRole("button", { name: "提取项目事实", exact: true })
      .click();
    await page.getByRole("button", { name: "保存核对结果" }).click();
    await page
      .getByLabel("事实 1", { exact: true })
      .fill("修改后的合成事实说明");
    await page.reload();
    await expect(page.getByLabel("事实 1", { exact: true })).toHaveValue(
      "修改后的合成事实说明",
    );
    await expect(page.getByRole("status")).toContainText(
      "已恢复尚未保存的事实核对",
    );
    await page.getByRole("button", { name: "放弃本次核对修改" }).click();
    await expect(page.getByLabel("事实 1", { exact: true })).not.toHaveValue(
      "修改后的合成事实说明",
    );
    await page.screenshot({
      path: `test-results/fact-review-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "查看训练包与剩余次数" }).click();
    await expect(page.locator(".purchase-context")).toBeVisible();
    await page.getByRole("button", { name: "创建模拟订单" }).click();
    await page.getByRole("button", { name: "模拟支付成功" }).click();
    await expect(page.getByText("已确认，权益已发放")).toBeVisible();
    await page.getByRole("link", { name: "返回原项目开始练习" }).click();
    await expect(page).toHaveURL(new RegExp("#/projects/" + project.id + "$"));
    await expect(page.locator(".readiness-list")).toContainText(
      "剩余 10 次可用深挖",
    );
    await page.getByRole("button", { name: "开始项目深挖" }).click();
    await expect(page).toHaveURL(/#\/trainings\/[a-f0-9-]+$/);
    const trainingId = page.url().split("/").pop()!;
    await page
      .getByLabel("你的回答", { exact: true })
      .fill(
        "我负责预约创建接口，使用数据库唯一约束保证同一座位和时间段只写入一条，冲突回滚。并发测试还需要补充输入和断言。",
      );
    await page.getByRole("button", { name: "提交并继续" }).click();
    await expect(page.getByText("问题 02", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `test-results/interview-${viewport.width}.png`,
      fullPage: true,
    });
    await page.goto("/#/projects");
    await expect(page.locator(".resume-band")).toContainText(
      "已保存 1/5 个回答",
    );
    await page.locator(".resume-row").first().click();
    await expect(page).toHaveURL(new RegExp(trainingId + "$"));
    await page
      .getByRole("button", { name: "结束训练并复盘（仅使用已提交回答）" })
      .click();
    await expect(
      page.getByRole("heading", { name: /复盘报告$/ }),
    ).toBeVisible();
    await page.locator(".plan-details summary").first().click();
    await page
      .getByLabel("补充笔记 1", { exact: true })
      .fill("补充两个并发请求的测试输入和数据库断言。");
    await page
      .getByRole("checkbox", { name: "我已补充这项（自报进度）" })
      .first()
      .check();
    await page.getByRole("button", { name: "保存复盘进度" }).first().click();
    await expect(page.locator(".plan-task").first()).toContainText(
      "进度已保存",
    );
    await page.reload();
    await page.locator(".plan-details summary").first().click();
    await expect(page.getByLabel("补充笔记 1", { exact: true })).toHaveValue(
      "补充两个并发请求的测试输入和数据库断言。",
    );
    await expect(
      page.getByRole("checkbox", { name: "我已补充这项（自报进度）" }).first(),
    ).toBeChecked();
    const value = await (
      await page.context().request.get("/api/trainings/" + trainingId)
    ).json();
    expect(value.planVersion).toBe(1);
    expect(value.reportPlan[0].done).toBe(true);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 Markdown 报告" }).click();
    const result = await download;
    expect(result.suggestedFilename()).toMatch(/复盘报告\.md$/);
    await result.saveAs(test.info().outputPath("report.md"));
    await page.screenshot({
      path: `test-results/report-plan-${viewport.width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await post("/trainings/" + trainingId + "/plan", {
      taskIndex: 0,
      done: false,
      note: "另一个页面修改",
      version: 1,
    });
    await page
      .getByLabel("补充笔记 1", { exact: true })
      .fill("当前页面不应覆盖其他修改");
    await page.getByRole("button", { name: "保存复盘进度" }).first().click();
    await expect(page.getByRole("alert")).toContainText("其他页面更新");
    await expect(page.getByLabel("补充笔记 1", { exact: true })).toHaveValue(
      "当前页面不应覆盖其他修改",
    );
  });
}

test("未登录体验不触发模型或订单，原页面登录后恢复", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") writes.push(r.url());
  });
  await page.goto("/");
  await page.getByLabel("体验回答").fill("我需要核对检查和写入的并发边界。");
  await page.getByRole("button", { name: "查看复盘角度" }).click();
  await expect(page.locator(".sample-feedback")).toContainText("固定场景");
  expect(writes).toEqual([]);
  await page.goto("/#/projects/new");
  await page
    .getByLabel("用户名", { exact: true })
    .fill("return-" + crypto.randomUUID());
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-test-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await expect(page).toHaveURL(/#\/projects\/new$/);
});

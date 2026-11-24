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
  test(`工作台、材料草稿、继续训练与复盘持久化 ${viewport.width}`, async ({
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
    await expect(page.getByLabel("练习概览")).toHaveCount(0);
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
    await page.getByRole("link", { name: "编辑材料", exact: true }).click();
    await page
      .getByLabel("项目经历")
      .fill("未保存的合成验证笔记");
    page.on("dialog", (dialog) => dialog.accept());
    await page.reload();
    await expect(page.getByLabel("项目经历")).toHaveValue(
      "未保存的合成验证笔记",
    );
    await expect(page.getByRole("status")).toContainText(
      "已恢复此标签页未保存的材料",
    );
    await page.getByRole("button", { name: "保存项目材料" }).click();
    await expect(page.getByRole("button", { name: "事实核对", exact: true })).toHaveCount(0);
    const training = await post("/trainings", { projectId: project.id, requestKey: crypto.randomUUID() });
    const trainingId = training.id;
    await page.goto("/#/trainings/" + trainingId);
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

test("已有旧版示例不发出写入请求，登录后回到原页面", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") writes.push(r.url());
  });
  await page.addInitScript(() => {
    const key = "project-probe:experience:v1";
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({
      version: 1, sample: "booking", started: true, answers: [], draft: "",
      notes: Array(5).fill(""), checked: Array(5).fill(false),
    }));
  });
  await page.goto("/#/experience?mode=legacy");
  const answer = page.getByLabel("本轮回答");
  await answer.fill("我需要核对检查和写入的并发边界。");
  await page.getByRole("button", { name: "保存回答，继续追问" }).click();
  await expect(answer).toHaveValue("");
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

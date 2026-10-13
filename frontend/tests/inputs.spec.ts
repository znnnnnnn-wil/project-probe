import { test, expect, type Page } from "@playwright/test";
import { demoProject } from "../src/api";

test.use({
  launchOptions: {
    channel: "msedge",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
async function seed(page: Page) {
  const headers = { Origin: "http://localhost:5174" };
  const post = async (path: string, data: unknown = {}) => {
    const response = await page.request.post("/api" + path, { headers, data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  await post("/auth/register", {
    username: "inputs-" + crypto.randomUUID(),
    password: "synthetic-test-password",
  });
  let project = await post("/projects", demoProject);
  project = await post("/projects/" + project.id + "/extract");
  await post("/projects/" + project.id + "/confirm", {
    version: project.version,
    facts: project.facts,
  });
  const order = await post("/orders", { requestKey: crypto.randomUUID() });
  await post("/orders/" + order.id + "/mock-pay");
  const training = await post("/trainings", {
    projectId: project.id,
    requestKey: crypto.randomUUID(),
  });
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        modelMode: "live",
        modelName: "private-model-name",
        speechEnabled: true,
        resumeImportEnabled: true,
        paymentMode: "mock",
        paymentConfigured: true,
      },
    }),
  );
  return { training, project };
}
for (const width of [1440, 390]) {
  test(`简历识别选项目、自动填入与保存 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    let requests = 0;
    const candidate = {
      ...demoProject,
      name: "简历合成预约项目",
      resume: "简历合成预约项目：我实现预约接口。",
      responsibility: "我实现预约接口。",
    };
    await page.route("**/api/resume/import", (route) => {
      requests++;
      return route.fulfill({
        json: {
          projects: [candidate, { ...candidate, name: "第二个合成项目" }],
          duplicate: requests > 1,
        },
      });
    });
    await page.goto("/#/projects/new");
    await expect(page.locator(".mode-strip")).not.toContainText("真实 AI");
    await expect(page.locator(".mode-strip")).not.toContainText(
      "private-model-name",
    );
    await expect(
      page.getByRole("button", { name: "导入简历", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("checkbox", {
        name: "同意将简历文字发送至模型服务，并在本账号缓存识别结果30天",
      })
      .check();
    await page.getByLabel("上传简历文件").setInputFiles({
      name: "synthetic.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(candidate.resume),
    });
    await expect(page.locator(".resume-candidate")).toHaveCount(2);
    await page.getByLabel("上传简历文件").setInputFiles({
      name: "renamed.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(candidate.resume),
    });
    await expect(page.getByRole("status")).toContainText("这份简历已上传过");
    await expect(page.locator(".resume-candidate")).toHaveCount(2);
    await page
      .locator(".resume-candidate")
      .first()
      .getByRole("button", { name: "使用这个项目" })
      .click();
    await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
      candidate.name,
    );
    await expect(
      page.getByLabel("个人职责（必填）", { exact: true }),
    ).toHaveValue(candidate.responsibility);
    await page.screenshot({
      path: `test-results/resume-import-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "保存项目材料" }).click();
    await expect(page).toHaveURL(/#\/projects\/[a-f0-9-]+$/);
    await page.reload();
    await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
      candidate.name,
    );
    expect(requests).toBe(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
  test(`录音、转写、编辑加入回答且不自动提交 ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["microphone"]);
    const { training } = await seed(page);
    let requests = 0;
    let answerWrites = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/answer") && request.method() === "POST")
        answerWrites++;
    });
    await page.route("**/transcribe", (route) => {
      requests++;
      expect(route.request().postDataBuffer()!.length).toBeGreaterThan(1000);
      return route.fulfill({
        json: { text: "我负责预约接口，使用数据库唯一约束。" },
      });
    });
    await page.goto("/#/trainings/" + training.id);
    await page.getByLabel("你的回答", { exact: true }).fill("已有草稿");
    await page
      .getByRole("checkbox", { name: "同意将本段录音发送至百炼进行语音识别" })
      .check();
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "结束录音", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "提交并继续", exact: true }),
    ).toBeDisabled();
    await page.waitForTimeout(850);
    await page.getByRole("button", { name: "结束录音", exact: true }).click();
    await page.getByRole("button", { name: "转为文字", exact: true }).click();
    await expect(page.getByLabel("语音转写结果")).toHaveValue(
      "我负责预约接口，使用数据库唯一约束。",
    );
    await expect(page.getByLabel("你的回答", { exact: true })).toHaveValue(
      "已有草稿",
    );
    await page
      .getByLabel("语音转写结果")
      .fill("我负责预约接口，验证方式还待补充。");
    await page.screenshot({
      path: `test-results/voice-input-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "加入回答", exact: true }).click();
    await expect(page.getByLabel("你的回答", { exact: true })).toHaveValue(
      "已有草稿\n我负责预约接口，验证方式还待补充。",
    );
    await page.reload();
    await expect(page.getByLabel("你的回答", { exact: true })).toHaveValue(
      "已有草稿\n我负责预约接口，验证方式还待补充。",
    );
    expect(requests).toBe(1);
    expect(answerWrites).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  });
}
test("简历失败可重试、原草稿不被覆盖", async ({ page }) => {
  await seed(page);
  let count = 0;
  await page.route("**/api/resume/import", (route) => {
    count++;
    return count === 1
      ? route.fulfill({ status: 503, json: { message: "识别暂不可用" } })
      : route.fulfill({ json: { projects: [] } });
  });
  await page.goto("/#/projects/new");
  await page.getByLabel("项目名称", { exact: true }).fill("原草稿");
  await page
    .getByRole("checkbox", {
      name: "同意将简历文字发送至模型服务，并在本账号缓存识别结果30天",
    })
    .check();
  const file = {
    name: "test.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic resume project example"),
  };
  await page.getByLabel("上传简历文件").setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("识别暂不可用");
  await page.getByLabel("上传简历文件").setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("未识别到项目经历");
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
    "原草稿",
  );
  expect(count).toBe(2);
});
test("录音取消不上传、转写失败保留录音可重试", async ({ page, context }) => {
  await context.grantPermissions(["microphone"]);
  const { training } = await seed(page);
  let count = 0;
  await page.route("**/transcribe", (route) => {
    count++;
    return count === 1
      ? route.fulfill({ status: 503, json: { message: "语音识别超时" } })
      : route.fulfill({ json: { text: "合成转写" } });
  });
  await page.goto("/#/trainings/" + training.id);
  await page
    .getByRole("checkbox", { name: "同意将本段录音发送至百炼进行语音识别" })
    .check();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消录音" })).toBeVisible();
  await page.getByRole("button", { name: "取消录音" }).click();
  expect(count).toBe(0);
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "结束录音", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(850);
  await page.getByRole("button", { name: "结束录音", exact: true }).click();
  await page.getByRole("button", { name: "转为文字", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("语音识别超时");
  await expect(page.locator(".recorded-audio audio")).toBeVisible();
  await page.getByRole("button", { name: "转为文字", exact: true }).click();
  await expect(page.getByLabel("语音转写结果")).toHaveValue("合成转写");
  expect(count).toBe(2);
});

import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mockHandsFree, mockPracticeVoice } from "../tests/practice-voice-fixture";
import type { Practice } from "../src/use-project-practice";

test("已有的旧版示例可以离线续练、恢复草稿并导出", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { message: "测试：后端离线" } }),
  );
  await page.addInitScript(() => {
    const key = "project-probe:experience:v1";
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({
      version: 1, sample: "booking", started: true, answers: [], draft: "",
      notes: Array(5).fill(""), checked: Array(5).fill(false),
    }));
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /把项目经历[，,]\s*讲清楚/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "开始示例练习", exact: true }).click();
  await page.getByRole("link", { name: "查看当前标签页的旧版示例练习" }).click();
  await page.getByLabel("本轮回答").fill("第一轮草稿：我负责预约接口。");
  await page.reload();
  await expect(page.getByLabel("本轮回答")).toHaveValue(
    "第一轮草稿：我负责预约接口。",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (let i = 0; i < 5; i++) {
    await page
      .getByLabel("本轮回答")
      .fill(`第${i + 1}轮的真实输入：数据库约束仍需并发验证。`);
    await page
      .getByRole("button", {
        name: i === 4 ? "保存并查看复盘" : "保存回答，继续追问",
      })
      .click();
    if (i < 4) await expect(page.getByLabel("本轮回答")).toHaveValue("");
  }
  await expect(
    page.getByRole("heading", { name: "这轮练习，留下了什么？" }),
  ).toBeVisible();
  await page
    .getByLabel("补充笔记")
    .first()
    .fill("补做两个请求同时预约的测试。");
  await page.getByRole("checkbox").first().check();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出复盘 Markdown" }).click();
  const file = await event;
  const content = await readFile((await file.path())!, "utf8");
  expect(content).toContain("不构成 AI 技术评估");
  expect(content).toContain("第5轮的真实输入");
  expect(content).toContain("材料原文（关键实现）");
  expect(content).toContain("补做两个请求同时预约的测试");
  await page.reload();
  await expect(page.getByLabel("补充笔记").first()).toHaveValue(
    "补做两个请求同时预约的测试。",
  );
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  expect(errors).toEqual([]);
});

test("项目语音面试刷新后可续训，完成后可回看档案", async ({ page }) => {
  let answer = "";
  const voice = await mockPracticeVoice(page, () => answer);
  await page.goto("/#/login");
  await page
    .getByLabel("用户名", { exact: true })
    .fill("competition-" + crypto.randomUUID());
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-test-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await page.goto("/#/projects/new");
  await page.getByLabel("项目名称", { exact: true }).fill("我的合成训练项目");
  await page
    .getByLabel("项目经历", { exact: true })
    .fill("我负责预约接口和数据库唯一约束，前端由同学负责。");
  await page.getByRole("button", { name: "保存项目材料", exact: true }).click();
  await page.getByRole("button", { name: "返回项目列表" }).click();
  await page.getByRole("link", { name: "进入面试室" }).click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByRole("button", { name: "用参考回答开始" })).toHaveCount(0);
  await room.getByRole("button", { name: "同意并开始语音面试" }).click();
  const project = new URL(page.url()).hash.split("/").pop()!.split("?")[0];
  for (let i = 0; i < 5; i++) {
    const progress = room.getByText(`第 ${i + 1} / 5 题`, { exact: true });
    await expect(progress).toBeVisible();
    if (i === 0) await expect(room.getByRole("region", { name: "参考回答" })).toHaveCount(0);
    if (i === 1) {
      await page.reload();
      await expect(progress).toBeVisible();
      await room.getByRole("button", { name: "同意并进入语音面试" }).click();
    }
    answer = `第${i + 1}题：我负责预约接口，通过数据库唯一约束避免重复写入，尚未验证并发。`;
    await voice.speak();
  }
  const archive = page.getByRole("region", { name: "面试详情" });
  await expect(archive.getByRole("region", { name: "本场评分" })).toContainText("未评分");
  await expect(page.locator("#project-materials")).toHaveCount(0);
  const exportEvent = page.waitForEvent("download");
  await archive.getByRole("button", { name: "导出本轮复盘" }).click();
  const exported = await exportEvent;
  expect(await readFile((await exported.path())!, "utf8")).toContain("第5题");
  const state = await (
    await page.request.get(`/api/projects/${project}/practice`)
  ).json();
  await expect(page).toHaveURL(new URL(`/#/history/${project}/${state.roundId}`, page.url()).href);
  expect(state.status).toBe("COMPLETED");
  expect(state.turns).toHaveLength(5);
  for (let i = 0; i < 5; i++)
    expect(state.turns[i].answer).toContain(`第${i + 1}题`);
  const retest = archive.getByRole("region", { name: "专项复测" });
  const feedbackChoices = retest.getByRole("radio");
  if (await feedbackChoices.count() > 1) {
    await feedbackChoices.first().focus();
    await feedbackChoices.first().press("ArrowRight");
    await expect(feedbackChoices.nth(1)).toBeChecked();
  }
  const revised = "测试输入：两次并发预约。预期结果：只有一笔有效预约。";
  await retest.getByLabel("补答").fill(revised);
  await retest.getByRole("button", { name: "提交补答并对照" }).click();
  await expect(retest.getByText(/新增了标注：测试输入、预期结果/)).toBeVisible();
  await page.reload();
  await expect(retest.getByText(revised, { exact: true })).toBeVisible();

  await page.goto("/#/history");
  await page.getByRole("link", { name: /我的合成训练项目/ }).click();
  await expect(page.getByText("专项复测已完成", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "查看报告与对话" }).click();
  await expect(archive.getByRole("region", { name: "本场评分" })).toContainText("未评分");
  await expect(archive.getByRole("region", { name: "完整对话" })).toContainText("第5题：我负责预约接口");
  await expect(archive.getByRole("region", { name: "专项复测" }).getByText(revised, { exact: true })).toBeVisible();
  const finalExport = page.waitForEvent("download");
  await archive.getByRole("button", { name: "导出本轮复盘" }).click();
  const finalContent = await readFile((await (await finalExport).path())!, "utf8");
  expect(finalContent).toContain("## 专项复测");
  expect(finalContent).toContain(revised);
});

test("手机访客直接进入正式面试室，答疑、报告和复测均可从训练记录回看", async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let privateHistoryReads = 0;
  page.on("request", request => {
    if (["/api/practice-history", "/api/training-page"].includes(new URL(request.url()).pathname))
      privateHistoryReads++;
  });
  let answer = "";
  const voice = await mockPracticeVoice(page, () => answer);
  await page.goto("/#/history");
  await expect(page.getByRole("heading", { name: "还没有示例训练记录" })).toBeVisible();
  await page.goto("/#/experience?sample=rag");
  await expect(page.getByRole("heading", { name: "选择练习场景" })).toBeVisible();
  const examples = page.getByRole("group", { name: "练习场景" });
  await expect(examples.getByRole("button")).toHaveCount(3);
  const rag = examples.getByRole("button", { name: /课程资料问答助手/ });
  await expect(rag).toHaveAttribute("aria-pressed", "true");
  await examples.getByRole("button", { name: /校园通知定时发送服务/ }).click();
  await expect(page.getByRole("region", { name: "练习预览" })).toContainText("校园通知定时发送服务");
  await rag.click();
  await expect(page.getByRole("region", { name: "练习材料" })).toContainText("段落编号");
  await page.getByRole("button", { name: "开始五轮练习" }).click();

  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByRole("region", { name: "项目相关信息" })).toContainText("向量检索");
  await expect(room.getByRole("region", { name: "项目相关信息" })).toContainText("课程讲义");
  await room.getByText("项目经历原文", { exact: true }).click();
  await expect(room.getByText(/相似章节容易召回错误片段/)).toBeVisible();
  await expect(room.getByRole("button", { name: "返回示例项目" })).toBeVisible();
  expect(await room.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  const openUrl = page.url();
  const projectId = new URL(openUrl).hash.split("/").pop();
  const endpoint = "/api/examples/projects/" + projectId + "/practice";
  await room.getByLabel("面试主题（选填）").fill("检索与引用");
  await room.getByRole("button", { name: "同意并开始语音面试" }).click();
  const progress = (i: number) => room.getByText(`第 ${i} / 5 题`, { exact: true });
  await expect(progress(1)).toBeVisible();
  const reference = room.getByRole("region", { name: "参考回答" });
  await expect(reference).toContainText("我负责讲义切分");
  expect((await reference.locator("p").innerText()).length).toBeLessThanOrEqual(48);
  expect((await (await page.request.get(endpoint)).json()).turns[0].answer).toBe("");
  answer = "我负责检索。";
  await voice.speak();
  await expect(reference).toContainText("把问题转成向量");
  expect((await reference.locator("p").innerText()).length).toBeLessThanOrEqual(48);
  await expect(progress(1)).toBeVisible();
  answer = "这题我不会";
  await voice.speak();
  await expect(room.getByText(/正在讲解本题，没听懂可以继续问/)).toBeVisible();
  await expect(reference).toContainText("我学会了。");
  await expect(progress(1)).toBeVisible();
  await reference.getByRole("button", { name: "发送参考回答" }).click();
  await expect(progress(2)).toBeVisible();

  await room.getByRole("button", { name: "返回示例项目" }).click();
  await page.getByRole("link", { name: "查看训练记录" }).click();
  await page.getByRole("link", { name: /课程资料问答助手/ }).click();
  await page.getByRole("link", { name: "继续训练" }).click();
  await expect(progress(2)).toBeVisible();
  await expect(room.getByRole("button", { name: "发送参考回答" })).toHaveCount(0);
  await room.getByRole("button", { name: "同意并进入语音面试" }).click();
  for (let i = 2; i <= 5; i++) {
    await expect(progress(i)).toBeVisible();
    answer = `第${i}题：我负责文档切分，检索时保存课程讲义的段落编号，引用是否支持结论需要单独验证。`;
    await voice.speak();
  }

  const archive = page.getByRole("region", { name: "面试详情" });
  await expect(archive.getByRole("region", { name: "本场评分" })).toContainText("未评分");
  await expect(page).toHaveURL(/#\/history\/examples\/[^/]+\/[^/]+$/);
  const { roundId } = await (await page.request.get(endpoint)).json();
  expect((await page.request.get("/api/me")).status()).toBe(401);
  const revised = "测试输入：检索相似章节中的固定问题。预期结果：答案引用对应讲义段落。";
  const retest = archive.getByRole("region", { name: "专项复测" });
  await retest.getByLabel("补答").fill(revised);
  await retest.getByRole("button", { name: "提交补答并对照" }).click();
  await expect(retest.getByText("前后对照")).toBeVisible();

  await page.goto("/#/history");
  await page.getByRole("link", { name: /课程资料问答助手/ }).click();
  await expect(page.getByText("专项复测已完成")).toBeVisible();
  await page.getByRole("link", { name: "查看报告与对话" }).click();
  await page.reload();
  await expect(retest.getByText(revised, { exact: true })).toBeVisible();
  await expect(archive.getByRole("region", { name: "完整对话" })).toContainText("这题我不会");
  expect(privateHistoryReads).toBe(0);

  const other = await browser.newContext();
  try {
    const origin = new URL(openUrl).origin;
    expect(await (await other.request.get(origin + "/api/examples/practice-history")).json()).toEqual([]);
    const response = await other.request.get(origin + endpoint + "?roundId=" + roundId);
    expect(response.status()).toBe(404);
  } finally {
    await other.close();
  }
});

test("访客进入语音面试后可逐题发送参考回答，失败后可重试并回看报告", async ({ page }) => {
  const voice = await mockHandsFree(page);
  await page.route("**/api/config", route => route.fulfill({
    json: { modelMode: "demo", speechEnabled: true, ttsEnabled: false },
  }));
  let transcriptions = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname.endsWith("/practice/transcribe")) transcriptions++;
  });
  const sent: string[] = [];
  let interim: Practice | undefined;
  let observedFinalAnswer = false;
  let finalAnswerAccepted = false;
  let finishReport!: () => void;
  const reportReady = new Promise<void>(resolve => { finishReport = resolve; });
  await page.route(url => /\/api\/examples\/projects\/[^/]+\/practice$/.test(url.pathname), async route => {
    const request = route.request();
    if (request.method() === "GET" && interim && new URL(request.url()).searchParams.has("roundId")) {
      observedFinalAnswer = true;
      return route.fulfill({
        json: finalAnswerAccepted ? interim : {
          ...interim,
          turns: interim.turns?.map((turn, index, turns) => index === turns.length - 1 ? { ...turn, answer: "" } : turn),
        },
      });
    }
    if (request.method() === "POST") {
      const { answer } = request.postDataJSON();
      if (typeof answer === "string") {
        sent.push(answer);
        if (sent.length === 1) return route.abort();
        if (sent.length === 6) {
          const response = await route.fetch();
          interim = { ...await response.json(), status: "GENERATING", report: undefined };
          await reportReady;
          interim = undefined;
          return route.fulfill({ response });
        }
      }
    }
    return route.continue();
  });
  await page.goto("/#/experience?sample=booking");
  await page.getByRole("button", { name: "开始五轮练习" }).click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const start = room.getByRole("button", { name: "同意并开始语音面试" });
  await expect(start).toBeEnabled();
  await expect(room.getByRole("button", { name: "用参考回答开始" })).toHaveCount(0);
  await start.click();
  const projectId = new URL(page.url()).hash.split("/").pop();
  const reference = room.getByRole("region", { name: "参考回答" });
  const send = reference.getByRole("button", { name: "发送参考回答" });
  const expected: string[] = [];
  for (let i = 1; i <= 5; i++) {
    await expect(room.getByText(`第 ${i} / 5 题`, { exact: true })).toBeVisible();
    await expect(send).toBeEnabled();
    const answer = await reference.locator("p").innerText();
    expected.push(answer);
    if (i === 1) {
      await expect.poll(voice.broadcasts).not.toHaveLength(0);
      await send.evaluate(button => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });
      const draft = room.getByRole("region", { name: "未发送的回答" });
      await expect(draft).toContainText(answer);
      await draft.getByRole("button", { name: "重试发送" }).click();
    } else {
      await send.click();
    }
  }

  try {
    const progress = room.getByRole("heading", { name: "正在生成面试报告" });
    await expect.poll(() => observedFinalAnswer).toBe(true);
    await expect(room.getByText("正在处理最后一题", { exact: true })).toBeVisible();
    await expect(progress).toHaveCount(0);
    finalAnswerAccepted = true;
    await expect(progress).toBeVisible();
    await expect(room.locator(".practice-report-loading svg")).toHaveCSS("animation-name", "spin");
    await expect(room.getByText("面试官正在思考", { exact: true })).toHaveCount(0);
  } finally {
    finishReport();
  }
  await expect(page).toHaveURL(/#\/history\/examples\/[^/]+\/[^/]+$/);
  const archive = page.getByRole("region", { name: "面试详情" });
  await expect(archive.getByRole("region", { name: "完整对话" })).toContainText(expected[0]);
  const result = await (await page.request.get(`/api/examples/projects/${projectId}/practice`)).json();
  expect(result.turns.map((turn: { answer: string }) => turn.answer)).toEqual(expected);
  expect(sent).toEqual([expected[0], ...expected]);
  expect(transcriptions).toBe(0);
});

import { expect, test, type Page, type Route } from "@playwright/test";
import type { Practice } from "../src/use-project-practice";
import { mockHandsFree } from "./practice-voice-fixture";

const id = "77777777-7777-4777-8777-777777777777";
const endpoint = `/api/projects/${id}/practice`;
const interview = `/#/projects/${id}?interview=1`;
const firstTurn = { id: "first", topic: "职责", question: "请说明你的职责。", answer: "" };
const active: Practice = { status: "ACTIVE", roundId: "round", maxTurns: 1, turns: [firstTurn] };
const complete: Practice = { ...active, status: "COMPLETED", turns: [{ ...firstTurn, answer: "服务端保存的回答" }],
  report: { mode: "demo", clearParts: ["回答已保存"], findings: [], retestTopics: [] } };

async function mockCommon(page: Page, voice = false) {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const data: Record<string, unknown> = {
      "/api/config": { modelMode: "demo", speechEnabled: voice, ttsEnabled: false },
      "/api/me": { id: "synthetic", username: "状态恢复测试" },
      [`/api/projects/${id}`]: { id, name: "恢复状态的项目", version: 1 },
      "/api/projects": [], "/api/training-overview": { items: [] }, "/api/practice-history": [],
    };
    return route.fulfill({ json: data[path] ?? null });
  });
}

for (const hasAnswer of [false, true]) {
  test(`ASR关闭仍可恢复${hasAnswer ? "已提交回答的报告" : "首题生成失败的面试"}，无需麦克风`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const voice = await mockHandsFree(page);
    await mockCommon(page);
    let state: Practice = { ...active, status: "FAILED", turns: hasAnswer ? complete.turns : [] };
    const writes: unknown[] = [];
    await page.route(`**${endpoint}**`, route => {
      if (route.request().method() === "POST") {
        writes.push(route.request().postDataJSON());
        state = hasAnswer ? complete : active;
      }
      return route.fulfill({ json: state });
    });
    await page.goto(interview);
    const room = page.getByRole("dialog", { name: "项目面试室" });
    await expect(room.getByRole("button", { name: "取消语音面试", exact: true })).toBeEnabled();
    await room.getByRole("button", { name: hasAnswer ? "重试生成报告" : "重试生成首题", exact: true }).click();
    if (hasAnswer) {
      await expect(page).toHaveURL(new RegExp(`#/history/${id}/round$`));
      await expect(page.getByRole("region", { name: "完整对话" })).toContainText("服务端保存的回答");
    } else {
      await expect(room.getByRole("heading", { name: firstTurn.question, exact: true })).toBeVisible();
    }
    expect(writes).toEqual([{}]);
    expect(await voice.micRequested()).toBe(false);
    expect(errors).toEqual([]);
  });

  test(`刷新后无需同意语音即可取消${hasAnswer ? "有题目" : "无首题"}的失败面试`, async ({ page }) => {
    await mockCommon(page, true);
    let state: Practice = { ...active, status: "FAILED", turns: hasAnswer ? [firstTurn] : [] };
    await page.route(`**${endpoint}`, route => route.fulfill({ json: state }));
    await page.route(`**${endpoint}/cancel`, route => {
      expect(route.request().postDataJSON()).toEqual({ roundId: "round" });
      state = { status: "AVAILABLE", maxTurns: 1 };
      return route.fulfill({ json: state });
    });
    await page.goto(interview);
    await page.reload();
    await page.getByRole("button", { name: "取消语音面试", exact: true }).click();
    await expect(page).toHaveURL(/#\/projects$/);
    await page.goto(interview);
    await expect(page.getByRole("heading", { name: "开始项目面试", exact: true })).toBeVisible();
  });
}

for (const cancelStatus of [409, 503]) test(`取消返回${cancelStatus}会同步已经完成的面试，而不是停在旧草稿`, async ({ page }) => {
  await mockCommon(page, true);
  const voice = await mockHandsFree(page);
  let state: Practice = active;
  let submitted = false;
  let releaseAnswer!: () => void;
  const gate = new Promise<void>(resolve => { releaseAnswer = resolve; });
  await page.route(`**${endpoint}**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/transcribe")) return route.fulfill({ json: { text: "服务端保存的回答" } });
    if (path.endsWith("/cancel")) {
      state = complete;
      releaseAnswer();
      return route.fulfill({ status: cancelStatus, json: { message: "本场已完成或取消服务暂时不可用" } });
    }
    if (route.request().method() === "POST") {
      submitted = true;
      await gate;
      return route.fulfill({ json: complete });
    }
    return route.fulfill({ json: state });
  });
  await page.goto(interview);
  await page.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await voice.endSpeech();
  await expect.poll(() => submitted).toBe(true);
  await page.getByRole("button", { name: "取消语音面试", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/history/${id}/round$`));
  await expect(page.getByRole("region", { name: "完整对话" })).toContainText("服务端保存的回答");
  expect(await page.evaluate(projectId => sessionStorage.getItem("practice-draft:" + projectId), id)).toBeNull();
});

test("取消失败后仍在途的答复完成时重读服务端进度", async ({ page }) => {
  await mockCommon(page, true);
  const voice = await mockHandsFree(page);
  let state: Practice = active;
  let submitted = false;
  let releaseAnswer!: () => void;
  const gate = new Promise<void>(resolve => { releaseAnswer = resolve; });
  await page.route(`**${endpoint}**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/transcribe")) return route.fulfill({ json: { text: "服务端保存的回答" } });
    if (path.endsWith("/cancel")) return route.fulfill({ status: 503, json: { message: "暂未取消" } });
    if (route.request().method() === "POST") {
      submitted = true;
      await gate;
      state = complete;
    }
    return route.fulfill({ json: state });
  });
  await page.goto(interview);
  await page.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await voice.endSpeech();
  await expect.poll(() => submitted).toBe(true);
  await page.getByRole("button", { name: "取消语音面试", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("暂未取消");
  releaseAnswer();
  await expect(page).toHaveURL(new RegExp(`#/history/${id}/round$`));
  expect(await page.evaluate(projectId => sessionStorage.getItem("practice-draft:" + projectId), id)).toBeNull();
});

test("取消后重读失败时禁用旧题提交，允许重新读取状态", async ({ page }) => {
  await mockCommon(page);
  let failRead = false;
  let writes = 0;
  await page.route(`**${endpoint}**`, route => {
    if (route.request().url().endsWith("/cancel")) {
      failRead = true;
      return route.fulfill({ status: 503, json: { message: "网络中断" } });
    }
    if (route.request().method() === "POST") writes++;
    return route.fulfill(failRead ? { status: 503, json: { message: "读取失败" } } : { json: active });
  });
  await page.goto(interview);
  await page.getByRole("button", { name: "取消语音面试", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("取消结果暂未确认");
  failRead = false;
  await page.getByRole("button", { name: "重新读取训练状态", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(writes).toBe(0);
});

for (const readFails of [false, true]) test(`另一个标签页推进后转写409同步新题${readFails ? "且支持读取失败重试" : "并仅上传新题录音"}`, async ({ context, page }) => {
  await mockCommon(page, true);
  const other = await context.newPage();
  await mockCommon(other, true);
  const voice = await mockHandsFree(page);
  const nextTurn = { id: "next", topic: "验证", question: "请说明下一步验证。", answer: "" };
  let state: Practice = { ...active, maxTurns: 2 };
  let failNextRead = false;
  let conflicts = 0;
  const uploadTargets: string[] = [];
  const serveState = (route: Route) => {
    if (route.request().method() === "POST") state = { ...state, turns: [{ ...firstTurn, answer: "另一标签页的回答" }, nextTurn] };
    if (failNextRead) {
      failNextRead = false;
      return route.fulfill({ status: 503, json: { message: "同步新题暂时失败" } });
    }
    return route.fulfill({ json: state });
  };
  for (const tab of [page, other]) await tab.route(`**${endpoint}`, serveState);
  await page.route(`**${endpoint}/transcribe`, route => {
    const data = route.request().postDataBuffer()!.toString("latin1");
    const target = data.includes('name="turnId"\r\n\r\nfirst') ? "first" : "next";
    uploadTargets.push(target);
    if (target === "first") {
      conflicts++;
      failNextRead = readFails;
      return route.fulfill({ status: 409, json: { message: "题目已变化" } });
    }
    return route.fulfill({ json: { text: "" } });
  });
  await page.bringToFront();
  await page.goto(interview);
  await page.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
  await expect.poll(voice.micState).toEqual(["live", true]);
  await other.goto(interview);
  await other.evaluate(async path => { await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: "另一标签页的回答" }) }); }, endpoint);
  await page.bringToFront();
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await voice.endSpeech();
  if (readFails) {
    await expect(page.getByText("同步新题暂时失败", { exact: true })).toBeVisible();
    await expect.poll(voice.micState).toEqual(["live", false]);
    await page.getByRole("button", { name: "重新读取训练状态", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: nextTurn.question, exact: true })).toBeVisible();
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await voice.endSpeech();
  await expect.poll(() => uploadTargets).toEqual(["first", "next"]);
  expect(conflicts).toBe(1);
  await other.close();
});

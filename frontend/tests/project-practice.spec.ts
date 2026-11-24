import { test, expect } from "@playwright/test";
import { mockHandsFree, mockPracticeVoice, type TestVoiceWindow } from "./practice-voice-fixture";
import type { Practice } from "../src/use-project-practice";

for (const connection of ["ready", "delayed", "closed"] as const) test(
  "实时转写只提交一次最终文本 " + connection, async ({ page }) => {
  const voice = await mockHandsFree(page);
  await page.route("**/api/config", route => route.fulfill({
    json: { modelMode: "demo", speechEnabled: true, realtimeSpeechEnabled: true, ttsEnabled: false },
  }));
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  await post("/api/auth/register", { username: "realtime-" + crypto.randomUUID(), password: "synthetic-practice-password" });
  const project = await post("/api/projects", { name: "实时转写合成项目" });
  const endpoint = `/api/projects/${project.id}/practice`;
  let transmitted = 0;
  let committed = 0;
  let batchUploads = 0;
  let socketOpened = false;
  const transcript = "我负责预约接口和数据库唯一约束，此约束确保同一时段只写入一条记录。";
  await page.routeWebSocket(url => url.pathname === endpoint + "/transcribe-stream", socket => {
    socketOpened = true;
    socket.onMessage(message => {
      if (typeof message !== "string") transmitted += message.byteLength;
      else if (message === "finish") {
        committed++;
        socket.send(JSON.stringify({ text: transcript }));
      }
    });
    const ready = () => socket.send(JSON.stringify({ ready: true }));
    if (connection === "delayed") setTimeout(ready, 1500);
    else if (connection === "closed") socket.close();
    else ready();
  });
  await page.route("**" + endpoint + "/transcribe", route => {
    batchUploads++;
    return route.fulfill({ json: { text: transcript } });
  });
  const submissions: unknown[] = [];
  page.on("request", request => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path === endpoint && request.postDataJSON().answer) submissions.push(request.postDataJSON().answer);
  });
  await page.goto(`/#/projects/${project.id}?interview=1`);
  await page.getByRole("button", { name: "同意并开始语音面试" }).click();
  await expect.poll(voice.micState).toEqual(["live", true]);
  expect(socketOpened).toBe(false);
  await voice.beginSpeech();
  await expect.poll(() => socketOpened).toBe(true);
  if (connection === "ready") await expect.poll(() => transmitted).toBeGreaterThan(0);
  expect(submissions).toEqual([]);
  expect(committed).toBe(0);
  await voice.endSpeech();
  await expect.poll(() => submissions).toEqual([transcript]);
  expect(committed).toBe(connection === "closed" ? 0 : 1);
  expect(batchUploads).toBe(connection === "closed" ? 1 : 0);
});

test("流式讲解在完整回复到达前请求云端播报，失败后按顺序朗读剩余句子", async ({ page }) => {
  const id = "35888888-8888-4888-8888-888888888888";
  const path = "/api/projects/" + id + "/practice";
  const question = { id: "teach", topic: "并发", question: "如何阻止重复写入？", answer: "" };
  const answer = "我不会，请给我讲解";
  const first = "先在数据库里约束重复写入。";
  const second = "然后用并发测试验证。";
  const active = { status: "ACTIVE", roundId: "speech-round", maxTurns: 5, turns: [question] };
  const result = { ...active, turns: [{ ...question, explanation: first + second, exchanges: [{ answer, reply: first + second }] }] };
  const voice = await mockHandsFree(page);
  await page.addInitScript(({ path, first, second, result }) => {
    const nativeFetch = window.fetch.bind(window);
    Object.defineProperty(MediaSource, "isTypeSupported", { value: () => true });
    window.fetch = (input, init) => {
      if (input !== path || init?.method !== "POST") return nativeFetch(input, init);
      const encoder = new TextEncoder();
      const reply = new ReadableStream<Uint8Array>({
        start(controller) {
          const write = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          write({ sentence: first, speechTicket: "first-sentence-ticket" });
          window.addEventListener("continue-test-explanation", () => {
            write({ sentence: second, speechTicket: "second-sentence-ticket" });
            write({ result });
            controller.close();
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(reply, { headers: { "Content-Type": "application/x-ndjson" } }));
    };
  }, { path, first, second, result });
  const sentenceCalls: unknown[] = [];
  await page.route("**/api/**", route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === path + "/tts") {
      const request = route.request().postDataJSON();
      if (request.sentence) sentenceCalls.push(request);
      return route.fulfill({ status: 503 });
    }
    const responses: Record<string, unknown> = {
      "/api/config": { modelMode: "live", speechEnabled: true, ttsEnabled: true },
      "/api/me": { id: "synthetic", username: "语音验证" },
      ["/api/projects/" + id]: { id, name: "合成并发项目" },
      [path]: active,
      [path + "/transcribe"]: { text: answer },
    };
    return route.fulfill({ json: responses[endpoint] ?? [] });
  });
  await page.goto("/#/projects/" + id + "?interview=1");
  await page.getByRole("button", { name: "同意并进入语音面试" }).click();
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await voice.endSpeech();
  await expect.poll(() => sentenceCalls).toEqual([{ sentence: first, speechTicket: "first-sentence-ticket" }]);
  await expect.poll(async () => (await voice.playback()).playing).toBe(first);
  await expect(page.getByText("云端播报暂不可用，已切换到浏览器朗读。", { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("continue-test-explanation")));
  await expect(page.getByText(first + second, { exact: false }).first()).toBeVisible();
  await page.evaluate(() => (window as TestVoiceWindow).testPlayback?.onend?.(new Event("end") as SpeechSynthesisEvent));
  await expect.poll(async () => (await voice.playback()).playing).toBe(second);
  expect(sentenceCalls).toHaveLength(1);
});

test("面试完成后进入本场报告，项目材料单独编辑，复练后仍可回看", async ({ page }) => {
  const firstAnswer = "我负责接口与数据库约束：同一座位时段只写入一条预约，冲突回滚，并发尚未验证。";
  const voice = await mockPracticeVoice(page, () => firstAnswer);
  await page.goto("/#/login");
  await page.getByLabel("用户名", { exact: true }).fill("practice-" + crypto.randomUUID());
  await page.getByLabel("密码", { exact: true }).fill("synthetic-practice-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await page.goto("/#/projects/new");
  await expect(page.getByRole("button", { name: "手动填写" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("填写项目名称即可保存，其余信息按需补充。", { exact: true })).toBeVisible();
  await page.getByLabel("项目名称", { exact: true }).fill("合成试练项目");
  await page.getByLabel("项目简介", { exact: true }).fill("我实现预约接口和数据库唯一约束。");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "载入合成示例" }).click();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("合成试练项目");
  await expect(page.getByLabel("项目简介")).toHaveValue("我实现预约接口和数据库唯一约束。");
  await page.getByRole("button", { name: "保存项目材料", exact: true }).click();
  const backToProjects = page.getByRole("button", { name: "返回项目列表" });
  await expect(backToProjects).toBeVisible();
  const projectId = page.url().split("/").pop()!;
  const projectEndpoint = `/api/projects/${projectId}`;
  const original = await (await page.request.get(projectEndpoint)).json();
  await backToProjects.click();
  await page.getByRole("link", { name: "进入面试室" }).click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByLabel("面试主题（选填）")).toHaveValue("");
  await expect(page.locator("#project-materials, #project-practice")).toHaveCount(0);
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect(room.getByRole("heading", { name: /请介绍/ })).toBeVisible();
  await expect(room.getByRole("textbox", { name: "我的回答" })).toHaveCount(0);
  await voice.speak();
  const archive = page.getByRole("region", { name: "面试详情" });
  await expect(archive.getByRole("region", { name: "本场评分" })).toBeVisible();
  const firstRound = await (await page.request.get(`${projectEndpoint}/practice`)).json();
  const firstRoundPath = `/#/history/${projectId}/${firstRound.roundId}`;
  await expect(page).toHaveURL(new URL(firstRoundPath, page.url()).href);
  const transcript = archive.getByRole("region", { name: "完整对话" });
  const firstDialogue = transcript.getByRole("listitem", { name: "第 1 题对话", exact: true });
  const firstToggle = firstDialogue.locator("summary");
  const firstMessage = firstDialogue.getByText(firstAnswer, { exact: true });
  await expect(firstMessage).toBeHidden();
  await firstToggle.click();
  await expect(firstMessage).toBeVisible();
  await firstToggle.press("Enter");
  await expect(firstMessage).toBeHidden();
  await expect(page.locator("#project-materials")).toHaveCount(0);
  await expect(page.getByText("把刚才讲清楚的内容，带到下一轮", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "预览回答补充到材料" })).toHaveCount(0);
  const saved = await (await page.request.get(projectEndpoint)).json();
  expect(saved.version).toBe(original.version);
  expect(saved.materials).toBe(original.materials);
  const review = archive.getByRole("region", { name: "自愿练习反馈" });
  await review.getByRole("button", { name: "4分", exact: true }).click();
  await review.getByRole("button", { name: "愿意继续", exact: true }).click();
  await review.getByLabel("最卡住的一步（可选）").fill("合成调研：需要明确下一步。");
  await review.getByRole("button", { name: "保存练习反馈" }).click();
  await expect(review.getByRole("status")).toContainText("已记录这次练习反馈");
  const feedback = await (await page.request.get("/api/feedback")).json();
  expect(feedback.filter((item: { body: string }) => item.body.includes("练习反馈"))).toHaveLength(1);
  await page.goto("/#/projects");
  await page.getByRole("link", { name: "编辑材料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目材料", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "项目简介", exact: true })).toHaveValue("我实现预约接口和数据库唯一约束。");
  await expect(page.getByRole("region", { name: "本场评分" })).toHaveCount(0);
  await expect(page.locator("#project-practice, dialog.practice-room")).toHaveCount(0);
  await backToProjects.click();
  await page.getByRole("link", { name: "进入面试室", exact: true }).click();
  await expect(room.getByRole("heading", { name: "开始新一轮", exact: true })).toBeVisible();
  await room.getByLabel("面试主题（选填）").fill("数据库唯一约束");
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect(room.getByRole("button", { name: "暂停语音面试" })).toBeVisible();
  await expect(room.getByText("本轮主题：数据库唯一约束", { exact: true })).toBeVisible();
  const secondRound = await (await page.request.get(`/api/projects/${projectId}/practice`)).json();
  expect(secondRound.roundId).not.toBe(firstRound.roundId);
  expect(secondRound.interviewTopic).toBe("数据库唯一约束");
  expect(secondRound.turns[0].question).toContain("数据库唯一约束");
  await page.goto(`/#/projects/${projectId}?roundId=${firstRound.roundId}`);
  await expect(page).toHaveURL(new URL(firstRoundPath, page.url()).href);
  await expect(firstToggle).toBeVisible();
  await expect(firstMessage).toBeHidden();
  await firstToggle.click();
  await expect(firstMessage).toBeVisible();
  const projectHistory = `/#/history/${projectId}`;
  await page.goto(projectHistory);
  await page.getByRole("link", { name: "继续训练", exact: true }).click();
  await expect(page).toHaveURL(new URL(`/#/projects/${projectId}?interview=1&from=history`, page.url()).href);
  await expect(room.getByRole("button", { name: "同意并进入语音面试" })).toBeEnabled();
  await room.getByRole("button", { name: "返回项目训练记录", exact: true }).click();
  await expect(page).toHaveURL(new URL(projectHistory, page.url()).href);
  await expect(page.locator("#project-materials, #project-practice, dialog.practice-room")).toHaveCount(0);

  const origin = new URL(page.url()).origin;
  const created = await page.request.post("/api/projects", {
    headers: { Origin: origin }, data: { name: "第二个练习项目", responsibility: "接口开发" },
  });
  expect(created.ok()).toBeTruthy();
  const secondProject = await created.json();
  await page.goto(`/#/projects/${secondProject.id}?interview=1`);
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect(room.getByRole("heading", { name: /请介绍/ })).toBeVisible();
});

test("取消面试后重新进入是新轮次，暂停返回仍保留进度，取消失败可重试", async ({ page }) => {
  const voice = await mockPracticeVoice(page, () => "你好");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post("/api" + path, { headers: { Origin: origin }, data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  await post("/auth/register", { username: "cancel-practice-" + crypto.randomUUID(), password: "synthetic-practice-password" });
  const project = await post("/projects", { name: "取消后重开的项目" });
  const path = `/projects/${project.id}/practice`;
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await page.goto(`/#/projects/${project.id}?interview=1`);
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await voice.speak();
  await expect(room.getByRole("region", { name: "本题对话" })).toContainText("你好");
  const first = await (await page.request.get("/api" + path)).json();
  await room.getByRole("button", { name: "暂停语音面试", exact: true }).click();
  await expect(room.getByText("麦克风已暂停", { exact: true })).toBeVisible();
  await room.getByRole("button", { name: "继续语音面试", exact: true }).click();
  await room.getByRole("button", { name: "返回项目列表", exact: true }).click();
  await page.getByRole("link", { name: "进入面试室", exact: true }).click();
  await expect(room.getByRole("region", { name: "本题对话" })).toContainText("你好");
  expect((await (await page.request.get("/api" + path)).json()).roundId).toBe(first.roundId);
  await room.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(({ projectId, turnId }) => {
    sessionStorage.setItem("practice-draft:" + projectId, "待取消的草稿");
    sessionStorage.setItem("practice-draft-turn:" + projectId, turnId);
    sessionStorage.setItem("practice-draft-exchange:" + projectId, "1");
  }, { projectId: project.id, turnId: first.turns[0].id });
  await page.route("**/api" + path + "/cancel", route => route.fulfill({
    status: 503, json: { message: "取消暂时失败，请重试" },
  }), { times: 1 });
  await room.getByRole("button", { name: "取消语音面试", exact: true }).click();
  await expect(room.getByRole("alert")).toContainText("取消暂时失败，请重试");
  await expect(room.getByRole("button", { name: "继续语音面试", exact: true })).toBeEnabled();
  expect((await (await page.request.get("/api" + path)).json()).roundId).toBe(first.roundId);
  expect(await page.evaluate(id => sessionStorage.getItem("practice-draft:" + id), project.id)).toBe("待取消的草稿");

  await room.getByRole("button", { name: "取消语音面试", exact: true }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  expect((await (await page.request.get("/api" + path)).json()).status).toBe("AVAILABLE");
  expect(await page.evaluate(id => ["practice-draft:", "practice-draft-turn:", "practice-draft-exchange:"]
    .map(key => sessionStorage.getItem(key + id)), project.id)).toEqual([null, null, null]);
  expect(await (await page.request.get("/api/practice-history")).json()).toEqual([]);
  await page.getByRole("link", { name: "进入面试室", exact: true }).click();
  await page.reload();
  await expect(room.getByRole("heading", { name: "开始项目面试", exact: true })).toBeVisible();
  await expect(room.getByRole("region", { name: "本题对话" })).toHaveCount(0);
  await expect(room.getByRole("region", { name: "未发送的回答" })).toHaveCount(0);
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect(room.getByRole("heading", { name: /请介绍/ })).toBeVisible();
  const next = await (await page.request.get("/api" + path)).json();
  expect(next.roundId).not.toBe(first.roundId);
  expect(next.roundNumber).toBe(first.roundNumber + 1);
  expect(next.turns).toHaveLength(1);
  expect(next.turns[0].id).not.toBe(first.turns[0].id);
  expect(next.turns[0].answer).toBe("");
  expect(next.turns[0].exchanges ?? []).toEqual([]);
  expect(errors).toEqual([]);
});

test("练习草稿刷新与返回后保留，读取失败可重试", async ({ page }) => {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api" + path, { headers: { Origin: origin }, data });
    expect(r.ok()).toBeTruthy(); return r.json();
  };
  await post("/auth/register", { username: "draft-practice-" + crypto.randomUUID(), password: "synthetic-practice-password" });
  const p = await post("/projects", { name: "草稿练习", responsibility: "预约接口" });
  const active = await post(`/projects/${p.id}/practice`, {});
  const user = await (await page.request.get("/api/me")).json();
  const draft = "未提交的合成回答：数据库唯一约束。";
  await page.addInitScript(({ projectId, turnId, draft, userId }) => {
    if (sessionStorage.getItem("has-seeded-practice-draft")) return;
    sessionStorage.setItem("auth:owner", userId);
    sessionStorage.setItem("has-seeded-practice-draft", "1");
    sessionStorage.setItem("practice-draft:" + projectId, draft);
    sessionStorage.setItem("practice-draft-turn:" + projectId, turnId);
    sessionStorage.setItem("practice-draft-exchange:" + projectId, "0");
  }, { projectId: p.id, turnId: active.turns[0].id, draft, userId: user.id });
  await page.goto(`/#/projects/${p.id}?interview=1`);
  const practice = page.getByRole("dialog", { name: "项目面试室" });
  const savedAnswer = practice.getByRole("region", { name: "未发送的回答" }).getByText(draft, { exact: true });
  await expect(savedAnswer).toBeVisible();
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(savedAnswer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole("heading", { name: "我的项目", exact: true })).toBeVisible();
  await expect(page.locator("#project-materials, #project-practice, dialog.practice-room")).toHaveCount(0);
  await page.getByRole("link", { name: "进入面试室", exact: true }).click();
  await expect(savedAnswer).toBeVisible();
  let failed = true, writes = 0;
  await page.route(`**/api/projects/${p.id}/practice`, async route => {
    if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
    if (failed) await route.fulfill({ status: 503, json: { message: "合成状态读取失败" } });
    else await route.fulfill({ json: active });
  });
  await page.reload();
  await expect(practice.getByRole("alert")).toContainText("合成状态读取失败");
  await expect(practice.getByRole("button", { name: "同意并开始语音面试", exact: true })).toHaveCount(0);
  failed = false;
  await practice.getByRole("button", { name: "重新读取训练状态" }).click();
  await expect(savedAnswer).toBeVisible();
  expect(writes).toBe(0);
});

for (const leaveRoom of [false, true]) test(`取消期间迟到响应不影响${leaveRoom ? "重新进入的新面试与草稿" : "当前页面"}`, async ({ page }) => {
  const id = "66666666-6666-4666-8666-666666666666";
  const path = `/api/projects/${id}/practice`;
  const active = { status: "ACTIVE", roundId: "cancel-in-flight", maxTurns: 1,
    turns: [{ id: "turn", question: "请说明职责。", answer: "" }] };
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "demo", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "取消测试" },
    ["/api/projects/" + id]: { id, name: "取消中的面试" },
    "/api/projects": [],
    "/api/training-overview": { items: [] },
    [path]: active,
    [path + "/transcribe"]: { text: "这是一段等待处理的回答" },
  };
  let releaseAnswer!: () => void, releaseCancel!: () => void;
  const answerGate = new Promise<void>(resolve => { releaseAnswer = resolve; });
  const cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
  let submissions = 0, cancellations = 0;
  await page.route("**/api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === path && request.method() === "POST") {
      submissions++;
      await answerGate;
      return route.fulfill({ json: { ...active, status: "COMPLETED", report: { mode: "demo" } } });
    }
    if (pathname === path + "/cancel") {
      cancellations++;
      expect(request.postDataJSON()).toEqual({ roundId: active.roundId });
      await cancelGate;
      return route.fulfill({ json: { status: "AVAILABLE", maxTurns: 1 } });
    }
    return route.fulfill({ json: responses[pathname] ?? null });
  });
  const voice = await mockHandsFree(page);
  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await room.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await voice.endSpeech();
  await expect.poll(() => submissions).toBe(1);
  await room.getByRole("button", { name: "取消语音面试", exact: true }).click();
  await expect(room.getByRole("button", { name: "正在取消…", exact: true })).toBeDisabled();
  await expect.poll(voice.micState).toEqual(["ended", false]);
  const answerFinished = page.waitForEvent("requestfinished", request => new URL(request.url()).pathname === path && request.method() === "POST");
  releaseAnswer();
  await answerFinished;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(room.getByRole("button", { name: "正在取消…", exact: true })).toBeDisabled();
  expect(cancellations).toBe(1);
  if (leaveRoom) {
    await room.getByRole("button", { name: "返回项目列表", exact: true }).click();
    await expect(room).toHaveCount(0);
    responses[path] = { ...active, roundId: "new-round", turns: [{ id: "new-turn", question: "新一场的题目", answer: "" }] };
    await page.evaluate(projectId => {
      sessionStorage.setItem("practice-draft:" + projectId, "新一场的草稿");
      sessionStorage.setItem("practice-draft-turn:" + projectId, "new-turn");
      sessionStorage.setItem("practice-draft-exchange:" + projectId, "0");
      location.hash = `/projects/${projectId}?interview=1`;
    }, id);
    await expect(room.getByRole("heading", { name: "新一场的题目", exact: true })).toBeVisible();
    const cancelFinished = page.waitForEvent("requestfinished", request => new URL(request.url()).pathname === path + "/cancel");
    releaseCancel();
    await cancelFinished;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(room.getByText("新一场的草稿", { exact: true })).toBeVisible();
    expect(await page.evaluate(projectId => sessionStorage.getItem("practice-draft:" + projectId), id)).toBe("新一场的草稿");
  } else {
    releaseCancel();
    await expect(page).toHaveURL(/#\/projects$/);
    await expect(room).toHaveCount(0);
  }
});

test("刷新遇到正在生成只轮询读取，不重复提交", async ({ page }) => {
  const id = "22222222-2222-4222-8222-222222222222";
  let reads = 0, writes = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === "/api/config") json = { modelMode: "demo" };
    else if (path === "/api/me") json = { id: "synthetic", username: "生成恢复" };
    else if (path === "/api/projects/" + id) json = { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] };
    else if (path.endsWith("/practice")) {
      if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
      reads++;
      json = reads === 1 ? { status: "GENERATING" } : { status: "ACTIVE", turns: [{ id: "turn", question: "请说明预约流程。", answer: "" }] };
    } else if (path === "/api/trainings") json = [];
    else throw Error(path);
    await route.fulfill({ json });
  });
  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByRole("button", { name: /正在生成，自动恢复进度|正在准备/ })).toBeDisabled();
  await expect(room.getByRole("heading", { name: "请说明预约流程。" })).toBeVisible();
  expect(reads).toBeGreaterThan(1); expect(writes).toBe(0);
});

test("百炼 ASR 未就绪时可以检查语音服务，页面没有文字答题入口", async ({ page }) => {
  const id = "33333333-3333-4333-8333-333333333333";
  const practice = `/api/projects/${id}/practice`;
  let voiceAvailable = false;
  const responses: Record<string, unknown> = {
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] },
    [practice]: {
      status: "ACTIVE", maxTurns: 5,
      turns: [{ id: "turn", question: "请说明预约流程。", answer: "" }],
    },
    "/api/trainings": [],
  };
  await page.route("**/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/config") return route.fulfill({ json: { modelMode: "demo", speechEnabled: voiceAvailable } });
    expect(request.method()).toBe("GET");
    return route.fulfill({ json: responses[path] ?? null });
  });

  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByText("百炼 ASR 暂未就绪，当前无法开始语音面试。", { exact: true })).toBeVisible();
  await expect(room.getByRole("combobox", { name: "识别语言" })).toHaveCount(0);
  await expect(room.getByRole("textbox", { name: "我的回答" })).toHaveCount(0);
  await expect(room.getByRole("button", { name: /同意并进入语音面试|开始文字面试|开始语音输入/ })).toHaveCount(0);
  voiceAvailable = true;
  await room.getByRole("button", { name: "重新检查语音服务" }).click();
  await expect(room.getByRole("button", { name: "同意并进入语音面试" })).toBeEnabled();
});

test("开始免提语音面试后可用同一段录音重试转写", async ({ page }) => {
  const id = "44444444-4444-4444-8444-444444444444";
  const practice = "/api/projects/" + id + "/practice";
  const firstTurn = { id: "asr-turn", question: "请说明预约流程。", answer: "" };
  const nextTurn = { id: "next", question: "请说明重复请求的处理方式。", answer: "" };
  const recognized = "预约 API 会校验唯一键。";
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "live", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] },
    [practice]: { status: "AVAILABLE", maxTurns: 5 },
  };
  let starts = 0;
  let submissions = 0;
  const recordings: Buffer[] = [];
  await page.route("**/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === practice + "/transcribe") {
      expect(request.method()).toBe("POST");
      expect(request.headers()["content-type"]).toContain("multipart/form-data");
      const upload = request.postDataBuffer()!;
      const form = upload.toString("latin1");
      expect(form).toContain('name="turnId"\r\n\r\nasr-turn');
      expect(form).toContain('name="exchangeCount"\r\n\r\n0');
      const start = upload.indexOf("RIFF");
      expect(start).toBeGreaterThanOrEqual(0);
      recordings.push(upload.subarray(start, start + 8 + upload.readUInt32LE(start + 4)));
      if (recordings.length === 1)
        return route.fulfill({ status: 503, json: { message: "合成转写超时" } });
      return route.fulfill({ json: { text: recognized } });
    }
    if (path === practice && request.method() === "POST") {
      const body = request.postDataJSON();
      if (!body.answer) {
        expect(body).toEqual({ topic: "并发一致性" });
        starts++;
        return route.fulfill({ json: { status: "ACTIVE", maxTurns: 5, turns: [firstTurn] } });
      }
      expect(body).toEqual({ turnId: firstTurn.id, exchangeCount: 0, answer: recognized, dialogue: true });
      submissions++;
      return route.fulfill({ json: { status: "ACTIVE", maxTurns: 5, turns: [{ ...firstTurn, answer: recognized }, nextTurn] } });
    }
    return route.fulfill({ json: responses[path] ?? null });
  });
  const voice = await mockHandsFree(page);
  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await room.getByLabel("面试主题（选填）").fill("并发一致性");
  expect(await voice.micRequested()).toBe(false);
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect.poll(voice.broadcasts).toEqual([{ text: firstTurn.question, micReady: true }]);
  await expect.poll(voice.micState).toEqual(["live", true]);
  expect(recordings).toHaveLength(0);
  await voice.beginSpeech();
  await expect(room.getByText("正在听你说话", { exact: true })).toBeVisible();
  await voice.endSpeech();
  await expect(room.getByRole("alert")).toContainText("合成转写超时");
  expect([recordings.length, submissions]).toEqual([1, 0]);
  await room.getByRole("button", { name: "重试转写刚才的录音", exact: true }).click();
  await expect(room.getByRole("heading", { name: nextTurn.question, exact: true })).toBeVisible();
  expect([starts, recordings.length, submissions]).toEqual([1, 2, 1]);
  expect(recordings[1]).toEqual(recordings[0]);
});

test("免提面试播报时可开口打断，问候留在同一题", async ({ page }) => {
  const id = "55555555-5555-4555-8555-555555555555";
  const path = "/api/projects/" + id + "/practice";
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "demo", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "预约系统", responsibility: "预约接口", resume: "", facts: [] },
    "/api/projects": [],
    "/api/training-overview": { items: [] },
  };
  const initialTurn = { id: "first", question: "如何避免重复预约？", answer: "" };
  const response = { status: "ACTIVE", roundId: "voice-round", maxTurns: 5, turns: [initialTurn] };
  const followUp = "你好，我们继续说说重复预约。";
  const sufficient = "我们在数据库设置请求标识的唯一约束，重复请求读取原结果，并验证两次同时提交只产生一条记录。";
  const sentences = ["你好", sufficient];
  const replies = [
    { ...response, turns: [{ ...initialTurn, exchanges: [{ answer: "你好", reply: followUp }] }] },
    { ...response, turns: [{ ...initialTurn, answer: sufficient }, { id: "second", question: "如何处理缓存失效？", answer: "" }] },
  ];
  let uploads = 0;
  let submissions = 0;
  await page.route("**/api/**", route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === path + "/transcribe") {
      const form = request.postDataBuffer()!.toString("latin1");
      expect(form).toContain('name="turnId"\r\n\r\nfirst');
      expect(form).toContain('name="exchangeCount"\r\n\r\n' + uploads);
      expect(form).toContain("RIFF");
      return route.fulfill({ json: { text: sentences[uploads++] } });
    }
    if (pathname === path + "/cancel") {
      expect(request.method()).toBe("POST");
      expect(request.postDataJSON()).toEqual({ roundId: response.roundId });
      return route.fulfill({ json: { status: "AVAILABLE", maxTurns: 5 } });
    }
    if (pathname !== path) return route.fulfill({ json: responses[pathname] ?? null });
    if (request.method() === "GET") return route.fulfill({ json: response });
    expect(request.postDataJSON()).toEqual({
      answer: sentences[submissions], dialogue: true, turnId: "first", exchangeCount: submissions,
    });
    return route.fulfill({ json: replies[submissions++] });
  });

  const voice = await mockHandsFree(page, true);
  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const canInterrupt = room.getByText("面试官正在播报，可以直接开口打断", { exact: true });
  const listening = room.getByText("正在听你说话", { exact: true });
  const start = room.getByRole("button", { name: "同意并进入语音面试" });
  await expect(start).toHaveAccessibleDescription(/自动发往阿里云百炼/);
  expect(await voice.micRequested()).toBe(false);
  expect(await voice.broadcasts()).toEqual([]);
  await start.click();
  await expect.poll(voice.micRequested).toBe(true);
  await expect(room.getByText("正在准备麦克风", { exact: true })).toBeVisible();
  expect(await voice.broadcasts()).toEqual([]);
  expect(await voice.micState()).toBeNull();
  await voice.grantMic();
  await expect(canInterrupt).toBeVisible();
  await expect.poll(voice.playback).toEqual({ playing: initialTurn.question, interrupted: [] });
  expect(await voice.broadcasts()).toEqual([{ text: initialTurn.question, micReady: true }]);
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await expect(listening).toBeVisible();
  await expect.poll(voice.playback).toEqual({ playing: null, interrupted: [initialTurn.question] });
  expect([uploads, submissions]).toEqual([0, 0]);
  await voice.endSpeech();
  await expect(room.getByText(followUp)).toBeVisible();
  await expect(room.getByText("第 1 / 5 题")).toBeVisible();
  await expect(canInterrupt).toBeVisible();
  await expect.poll(voice.playback).toEqual({ playing: followUp, interrupted: [initialTurn.question] });
  await expect.poll(voice.micState).toEqual(["live", true]);

  await page.evaluate(async () => {
    // A cancelled browser utterance may report completion after the next one starts.
    (window as TestVoiceWindow).testInterrupted[0].onend?.(new Event("end") as SpeechSynthesisEvent);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(canInterrupt).toBeVisible();
  await voice.beginSpeech();
  await expect(listening).toBeVisible();
  await expect.poll(voice.playback).toEqual({ playing: null, interrupted: [initialTurn.question, followUp] });
  expect([uploads, submissions]).toEqual([1, 1]);
  await voice.endSpeech();
  await expect(room.getByText("第 2 / 5 题")).toBeVisible();
  await expect(room.getByRole("heading", { name: "如何处理缓存失效？" })).toBeVisible();
  expect([uploads, submissions]).toEqual([2, 2]);
  await room.getByRole("button", { name: "取消语音面试", exact: true }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole("heading", { name: "我的项目", exact: true })).toBeVisible();
  await expect(page.locator("#project-materials, #project-practice, dialog.practice-room")).toHaveCount(0);
  await expect.poll(voice.micState).toEqual(["ended", false]);
});

for (const width of [1440, 390]) test(`语音正常提交隐藏草稿卡片，失败仍可恢复 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const id = "77777777-7777-4777-8777-777777777777";
  const path = `/api/projects/${id}/practice`;
  const text = "服务端会先持久化请求标识，重复消息读取原结果。";
  const turn = { id: "draft-turn", question: "请说明重复请求的处理方式。", answer: "" };
  let state = { status: "ACTIVE", roundId: "draft-round", maxTurns: 5, turns: [turn] };
  let release!: () => void;
  let submissions = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === path && request.method() === "POST") {
      submissions++;
      expect(request.postDataJSON().answer).toBe(text);
      if (submissions === 1) {
        await gate;
        return route.fulfill({ status: 503, json: { message: "合成提交失败" } });
      }
      state = { ...state, turns: [{ ...turn, answer: text }, { id: "next-turn", question: "请说明故障恢复。", answer: "" }] };
      return route.fulfill({ json: state });
    }
    const responses: Record<string, unknown> = {
      "/api/config": { speechEnabled: true, ttsEnabled: false },
      "/api/me": { id: "synthetic", username: "草稿验证" },
      [`/api/projects/${id}`]: { id, name: "语音草稿验证" },
      [path]: state,
      [path + "/transcribe"]: { text },
    };
    return route.fulfill({ json: responses[pathname] ?? null });
  });
  const voice = await mockHandsFree(page);
  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const draft = room.getByRole("region", { name: "未发送的回答" });
  await room.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await voice.endSpeech();
  await expect.poll(() => submissions).toBe(1);
  await expect(room.getByRole("region", { name: "本题对话" })).toContainText(text);
  await expect(draft).toHaveCount(0);
  await expect(room.getByText("未发送的回答已保存在当前标签页。", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(project => sessionStorage.getItem("practice-draft:" + project), id)).toBe(text);
  release();
  await expect(draft).toContainText(text);
  await expect(draft.getByRole("button", { name: "重试发送", exact: true })).toBeEnabled();
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(draft).toContainText(text);
  await draft.getByRole("button", { name: "重试发送", exact: true }).click();
  await expect(room.getByRole("heading", { name: "请说明故障恢复。", exact: true })).toBeVisible();
  await expect(draft).toHaveCount(0);
  expect(submissions).toBe(2);
  expect(await page.evaluate(project => sessionStorage.getItem("practice-draft:" + project), id)).toBeNull();
});

for (const width of [1440, 390]) for (const ending of ["played", "muted", "failed"] as const) test(`不会后留在本题答疑，确认学会才推进或生成报告 ${width} ${ending}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  // Repeated room navigation is tested independently of the WebGL renderer.
  await page.route(/\/src\/interviewer-avatar\.tsx(?:\?|$)/, route => route.fulfill({
    contentType: "text/javascript",
    body: `import React from '/node_modules/.vite/deps/react.js';
      export function InterviewerAvatar() {
        return React.createElement('img', { src: '/models/interviewer-v2-portrait.webp', alt: '虚拟面试官陈老师', style: { width: '100%', height: '100%', objectFit: 'cover' } });
      }`,
  }));
  const id = "88888888-8888-4888-8888-888888888888";
  const path = `/api/projects/${id}/practice`;
  const interviewUrl = `/#/projects/${id}?interview=1`;
  const first = { id: "teach-first", topic: "消息确认", question: "Worker 应先提交数据库事务还是确认消息？", answer: "" };
  const second = { id: "teach-second", topic: "重试", question: "如何设计消费失败后的重试？", answer: "" };
  const steps = [
    { turnId: first.id, exchangeCount: 0, answer: "我不会，请给我讲解", reply: "应先提交数据库事务，再确认消息；确认失败可能重复投递，因此需要幂等处理。" },
    { turnId: first.id, exchangeCount: 1, answer: "没听懂，为什么不能先确认消息？", reply: "先确认后进程崩溃，未提交的事务会回滚，消息却不再投递。先提交再确认可避免丢失。" },
    { turnId: first.id, exchangeCount: 2, answer: "我学会了", reply: "已确认学会，我们继续下一题。" },
    { turnId: second.id, exchangeCount: 0, answer: "直接告诉我答案吧", reply: "重试需要限制次数并采用退避，最终失败进入人工处理；仍需幂等以应对重复投递。" },
    { turnId: second.id, exchangeCount: 1, answer: "我没懂，退避是什么意思？", reply: "退避就是失败后逐渐延长等待时间，避免持续重试让下游压力更大。" },
    { turnId: second.id, exchangeCount: 2, answer: "我学会了", reply: "已确认学会，本轮结束，正在生成报告。" },
  ];
  const active: Practice = { status: "ACTIVE", roundId: "teaching-round", maxTurns: 2, modelMode: "demo", turns: [first] };
  let state = active;
  let submissions = 0, uploads = 0, archiveReads = 0;
  const ttsCalls: unknown[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    const request = route.request();
    const url = new URL(request.url());
    const current = state.turns!.at(-1)!;
    const target = { turnId: current.id, exchangeCount: current.exchanges?.length ?? 0 };
    if (url.pathname === path + "/transcribe") {
      expect(request.method()).toBe("POST");
      expect(uploads).toBe(submissions);
      const step = steps[uploads++];
      expect(target).toEqual({ turnId: step.turnId, exchangeCount: step.exchangeCount });
      expect(current.answer).toBe("");
      const form = request.postDataBuffer()!.toString("latin1");
      expect(form).toContain(`name="turnId"\r\n\r\n${step.turnId}\r\n`);
      expect(form).toContain(`name="exchangeCount"\r\n\r\n${step.exchangeCount}\r\n`);
      expect(form).toContain("RIFF");
      return route.fulfill({ json: { text: step.answer } });
    }
    if (url.pathname === path && request.method() === "POST") {
      const { reply, ...step } = steps[submissions++];
      expect(request.postDataJSON()).toEqual({ ...step, dialogue: true });
      expect(target).toEqual({ turnId: step.turnId, exchangeCount: step.exchangeCount });
      expect(current.answer).toBe("");
      const exchanges = [...(current.exchanges ?? []), { answer: step.answer, reply }];
      const learned = step.answer === "我学会了";
      const updated = { ...current, exchanges, explanation: learned ? current.explanation : reply,
        answer: learned ? exchanges[0].answer : "" };
      state = { ...state, turns: [...state.turns!.slice(0, -1), updated] };
      if (learned && current.id === first.id) state.turns!.push(second);
      else if (learned) state = { ...state, status: "COMPLETED",
        report: { mode: "demo", clearParts: [], findings: [], retestTopics: [] } };
      return route.fulfill({ json: state });
    }
    if (url.pathname === path + "/tts") {
      expect(request.method()).toBe("POST");
      expect(state.status).toBe("ACTIVE");
      expect(request.postDataJSON()).toEqual(target);
      ttsCalls.push(target);
      return route.fulfill({ status: 503, json: { message: "合成云端播报故障" } });
    }
    if (url.pathname === path && url.searchParams.has("roundId")) {
      expect(state.status).toBe("COMPLETED");
      expect(url.searchParams.get("roundId")).toBe(active.roundId);
      archiveReads++;
    }
    expect(request.method()).toBe("GET");
    const responses: Record<string, unknown> = {
      "/api/config": { speechEnabled: true, ttsEnabled: ending === "failed" },
      "/api/me": { id: "synthetic", username: "讲解验证" },
      [`/api/projects/${id}`]: { id, name: "消息消费项目" },
      "/api/projects": [],
      "/api/training-overview": { items: [] },
      "/api/practice-history": [],
      [path]: state,
    };
    return route.fulfill({ json: responses[url.pathname] ?? null });
  });
  const voice = await mockHandsFree(page);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const teaching = room.getByRole("status").filter({ hasText: "正在讲解本题" });
  const dialogue = room.getByRole("region", { name: "本题对话", exact: true });
  const replay = room.getByRole("button", { name: "重新播报本题", exact: true });
  const playing = () => expect.poll(async () => (await voice.playback()).playing);
  const speak = async () => {
    await expect.poll(voice.micState).toEqual(["live", true]);
    await voice.beginSpeech();
    await voice.endSpeech();
  };
  const finishPlayback = async (failed = false) => {
    await page.evaluate(fail => {
      const utterance = (window as TestVoiceWindow).testPlayback;
      if (!utterance) throw new Error("Expected a playing utterance");
      if (fail) utterance.onerror?.(new Event("error") as SpeechSynthesisErrorEvent);
      else utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
    }, failed);
    await playing().toBeNull();
  };
  const lateEnds = () => page.evaluate(async () => {
    const interrupted = (window as TestVoiceWindow).testInterrupted;
    if (!interrupted.length) throw new Error("Expected an ended or interrupted utterance");
    interrupted.forEach(utterance => utterance.onend?.(new Event("end") as SpeechSynthesisEvent));
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  const stillTeaching = async (index: number, count: number) => {
    const question = [first, second][index];
    await expect(page).toHaveURL(/interview=1$/);
    await expect(room.getByRole("heading", { name: question.question, exact: true })).toBeVisible();
    await expect(room.getByText(`第 ${index + 1} / 2 题`, { exact: true })).toBeVisible();
    await expect(teaching).toContainText("没听懂可以继续问。学会后请说“我学会了”");
    await expect(teaching).toContainText(index ? "确认后生成本场报告" : "确认后再继续下一题");
    await expect(dialogue.getByRole("listitem")).toHaveCount(count);
    await expect(room.getByRole("region", { name: "未发送的回答" })).toHaveCount(0);
    await expect(room.getByRole("region", { name: "上一题讲解" })).toHaveCount(0);
    await expect(room.getByRole("button", { name: "查看本场报告", exact: true })).toHaveCount(0);
    expect(state.status).toBe("ACTIVE");
    expect(state.report).toBeUndefined();
    expect(state.turns).toHaveLength(index + 1);
    expect(state.turns!.at(-1)).toMatchObject({ id: question.id, question: question.question, answer: "" });
    expect(state.turns!.at(-1)!.exchanges).toHaveLength(count);
    expect(submissions).toBe(index * 3 + count);
    expect(uploads).toBe(submissions);
    expect(archiveReads).toBe(0);
  };
  await page.goto(interviewUrl);
  await room.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as TestVoiceWindow).testVadArmed), { timeout: 15000 }).toBe(true);
  await playing().toBe(first.question);
  for (const index of [0, 1]) {
    const initialReply = steps[index * 3].reply;
    const followUp = steps[index * 3 + 1].reply;
    await speak();
    await expect(dialogue).toContainText(initialReply);
    await playing().toBe(initialReply);
    await stillTeaching(index, 1);
    await expect(room.locator(".practice-question")).not.toContainText(initialReply);
    if (ending === "muted") {
      await room.getByRole("button", { name: "关闭面试官声音", exact: true }).click();
      await playing().toBeNull();
    } else await finishPlayback(ending === "failed");
    await lateEnds();
    await stillTeaching(index, 1);
    const broadcasts = await voice.broadcasts();
    await speak();
    await expect(dialogue).toContainText(followUp);
    await stillTeaching(index, 2);
    await expect(dialogue).toContainText(initialReply);
    if (ending === "muted") {
      expect(await voice.broadcasts()).toEqual(broadcasts);
      await room.getByRole("button", { name: "开启面试官声音", exact: true }).click();
    }
    await playing().toBe(followUp);
    await finishPlayback(ending === "failed");
    await stillTeaching(index, 2);
    await expect(replay).toBeEnabled();
    await replay.click();
    await playing().toBe(followUp);
    await lateEnds();
    await playing().toBe(followUp);
    await stillTeaching(index, 2);
    await finishPlayback();
    await room.getByRole("button", { name: "暂停语音面试", exact: true }).click();
    await expect(room.getByText("麦克风已暂停", { exact: true })).toBeVisible();
    await expect.poll(voice.micState).toEqual(["ended", false]);
    await stillTeaching(index, 2);
    await room.getByRole("button", { name: "继续语音面试", exact: true }).click();
    await expect.poll(voice.micState).toEqual(["live", true]);
    const beforeLeaving = await voice.broadcasts();
    if (width === 390) await page.reload();
    else {
      await room.getByRole("button", { name: "返回项目列表", exact: true }).click();
      await expect(page).toHaveURL(/#\/projects$/);
      await page.goto(interviewUrl);
    }
    await stillTeaching(index, 2);
    expect(await voice.broadcasts()).toEqual(width === 390 ? [] : beforeLeaving);
    await playing().toBeNull();
    if (index === 0) await page.screenshot({ path: testInfo.outputPath(`learning-${width}.png`), fullPage: true });
    await room.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
    await playing().toBe(followUp);
    const beforeConfirm = await voice.broadcasts();
    const ttsBeforeConfirm = ttsCalls.length;
    // Register before confirmation: the report request can finish during navigation.
    const archiveLoaded = index === 1 ? page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === path && url.searchParams.get("roundId") === active.roundId;
    }) : null;
    await speak();
    if (index === 0) {
      await expect(room.getByRole("heading", { name: second.question, exact: true })).toBeVisible();
      await expect(room.getByText("第 2 / 2 题", { exact: true })).toBeVisible();
      await expect(teaching).toHaveCount(0);
      await expect(room.getByRole("region", { name: "上一题讲解" })).toHaveCount(0);
      await playing().toBe(second.question);
      expect(await voice.broadcasts()).toEqual([...beforeConfirm, { text: second.question, micReady: true }]);
      expect(state.turns![0].answer).toBe(steps[0].answer);
      expect(state.turns![1].answer).toBe("");
    } else {
      await expect(page).toHaveURL(new RegExp(`#/history/${id}/teaching-round$`));
      expect((await archiveLoaded!).ok()).toBeTruthy();
      const transcript = page.getByRole("region", { name: "完整对话", exact: true });
      for (const turnIndex of [0, 1]) {
        const conversation = transcript.getByRole("listitem", { name: `第 ${turnIndex + 1} 题对话`, exact: true });
        await expect(conversation.getByText(steps[turnIndex * 3].answer, { exact: true })).toBeHidden();
        await conversation.locator("summary").click();
        for (const { answer, reply } of steps.slice(turnIndex * 3, turnIndex * 3 + 3)) {
          await expect(conversation.getByText(answer, { exact: true })).toBeVisible();
          await expect(conversation.getByText(reply, { exact: true })).toBeVisible();
        }
        expect(state.turns![turnIndex].answer).toBe(steps[turnIndex * 3].answer);
      }
      await lateEnds();
      await expect(page).toHaveURL(new RegExp(`#/history/${id}/teaching-round$`));
      await playing().toBeNull();
      expect(await voice.broadcasts()).toEqual(beforeConfirm);
      expect(ttsCalls).toHaveLength(ttsBeforeConfirm);
      expect(state.status).toBe("COMPLETED");
      expect([submissions, uploads, archiveReads]).toEqual([6, 6, 1]);
    }
  }
  expect(errors).toEqual([]);
});

for (const confirmation of [
  "学会了，你下一题吧。", "我学会了，继续吧。", "OK，我学会了下一题吧。", "理解了，已经全部都理解了。",
]) test(`隔离 demo 真实 API：确认“${confirmation}”后报告保存全部答疑`, async ({ page }) => {
  const answers = ["我不会，请给我讲解", "我没听懂，再解释一下", "继续吧", "我还没学会，继续讲吧", "我学会了？继续吧"];
  let recognized = answers[0];
  const voice = await mockPracticeVoice(page, () => recognized);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post("/api" + path, { headers: { Origin: origin }, data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  await post("/auth/register", { username: "teaching-" + crypto.randomUUID(), password: "synthetic-practice-password" });
  const project = await post("/projects", { name: "讲解答疑闭环项目", background: "我实现预约接口和数据库唯一约束。" });
  const path = `/api/projects/${project.id}/practice`;
  const readPractice = async (): Promise<Practice> => {
    const response = await page.request.get(path);
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const submissions: unknown[] = [];
  const uploads: string[] = [];
  page.on("request", request => {
    if (request.method() !== "POST") return;
    const pathname = new URL(request.url()).pathname;
    if (pathname === path) submissions.push(request.postDataJSON());
    if (pathname === path + "/transcribe") uploads.push(request.postDataBuffer()!.toString("latin1"));
  });
  await page.goto(`/#/projects/${project.id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const teaching = room.getByRole("status").filter({ hasText: "正在讲解本题" });
  const started = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "POST");
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  expect((await started).ok()).toBeTruthy();
  await expect(room.getByText("第 1 / 1 题", { exact: true })).toBeVisible();
  const active = await readPractice();
  expect(active).toMatchObject({ status: "ACTIVE", modelMode: "demo", maxTurns: 1 });
  expect(active.turns).toHaveLength(1);
  const initial = active.turns![0];
  expect(initial.answer).toBe("");
  expect(initial.exchanges ?? []).toEqual([]);
  for (const [index, answer] of answers.entries()) {
    recognized = answer;
    await voice.speak();
    await expect.poll(async () => (await readPractice()).turns?.[0].exchanges?.length).toBe(index + 1);
    const current = await readPractice();
    expect(current).toMatchObject({ status: "ACTIVE", roundId: active.roundId });
    expect(current.report).toBeFalsy();
    expect(current.turns).toHaveLength(1);
    const turn = current.turns![0];
    expect(turn).toMatchObject({ id: initial.id, question: initial.question, answer: "" });
    expect(turn.explanation).toBeTruthy();
    const reply = turn.exchanges!.at(-1)!.reply;
    expect(reply).toBeTruthy();
    await expect(room.getByRole("region", { name: "本题对话", exact: true })).toContainText(reply);
    await expect(teaching).toContainText("学会后请说“我学会了”，确认后生成本场报告");
    await expect.poll(() => page.evaluate(() => (window as TestVoiceWindow).testPlayback?.text)).toBe(reply);
    await page.evaluate(() => {
      const utterance = (window as TestVoiceWindow).testPlayback!;
      utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
      utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
    });
    await expect(room.getByRole("heading", { name: initial.question, exact: true })).toBeVisible();
    await expect(room.getByText("第 1 / 1 题", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/interview=1$/);
    expect((await readPractice()).turns).toEqual(current.turns);
  }
  const beforeReload = await readPractice();
  await page.reload();
  await expect(teaching).toBeVisible();
  await expect(room.getByRole("heading", { name: initial.question, exact: true })).toBeVisible();
  expect((await readPractice()).turns).toEqual(beforeReload.turns);
  await room.getByRole("button", { name: "同意并进入语音面试", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as TestVoiceWindow).testPlayback?.text))
    .toBe(beforeReload.turns![0].exchanges!.at(-1)!.reply);
  const beforeConfirm = await page.evaluate(() => (window as TestVoiceWindow).testBroadcasts);
  // Subscribe before sending the confirmation, not after the report route loads.
  const archiveLoaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === path && url.searchParams.get("roundId") === active.roundId;
  });
  recognized = confirmation;
  await voice.speak();
  await expect(page).toHaveURL(new RegExp(`#/history/${project.id}/${active.roundId}$`));
  const archivedResponse = await archiveLoaded;
  expect(archivedResponse.ok()).toBeTruthy();
  const archived: Practice = await archivedResponse.json();
  expect(archived.status).toBe("COMPLETED");
  expect(archived.report).toBeTruthy();
  expect(archived.turns).toHaveLength(1);
  const completed = archived.turns![0];
  expect(completed.id).toBe(initial.id);
  expect(completed.answer).toBe(answers[0]);
  expect(completed.exchanges!.map(exchange => exchange.answer)).toEqual([...answers, recognized]);
  expect(completed.exchanges!.slice(0, answers.length)).toEqual(beforeReload.turns![0].exchanges);
  const transcript = page.getByRole("region", { name: "完整对话", exact: true });
  await transcript.getByRole("listitem", { name: "第 1 题对话", exact: true }).locator("summary").click();
  for (const { answer, reply } of completed.exchanges!) {
    await expect(transcript).toContainText(answer);
    if (reply) await expect(transcript).toContainText(reply);
  }
  expect((await readPractice()).turns).toEqual(archived.turns);
  expect(submissions).toEqual([{}, ...[...answers, recognized].map((answer, exchangeCount) => ({
    turnId: initial.id, exchangeCount, answer, dialogue: true,
  }))]);
  expect(uploads).toHaveLength(answers.length + 1);
  uploads.forEach((form, exchangeCount) => {
    expect(form).toContain(`name="turnId"\r\n\r\n${initial.id}\r\n`);
    expect(form).toContain(`name="exchangeCount"\r\n\r\n${exchangeCount}\r\n`);
  });
  expect(await page.evaluate(() => (window as TestVoiceWindow).testBroadcasts)).toEqual(beforeConfirm);
  expect(await page.evaluate(() => (window as TestVoiceWindow).testPlayback?.text ?? null)).toBeNull();
  expect(errors).toEqual([]);
});

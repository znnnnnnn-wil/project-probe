import { test, expect, type Page } from "@playwright/test";
import type { Report, ScoreDimension } from "../src/types";
import type { Practice } from "../src/use-project-practice";

const projectId = "score-recovery";
const roundId = "completed-session";
const archivePath = `/#/history/${projectId}/${roundId}`;
const turn = {
  id: "request-turn", topic: "请求处理", question: "请介绍语音录入流程。",
  answer: "我负责把语音指令转换成日程，并按请求 ID 查重。",
};
const keys: ScoreDimension["key"][] = ["clarity", "ownership", "depth", "validation"];

function scoring(scores: [number | null, number | null, number | null, number | null]): NonNullable<Report["scoring"]> {
  return {
    total: scores.every(score => typeof score === "number")
      ? scores.reduce<number>((sum, score) => sum + (score ?? 0), 0) : null,
    dimensions: keys.map((key, index) => ({
      key, score: scores[index],
      reason: scores[index] === null ? "本项暂缺可核对的评分。" : "依据已保存的回答评分。",
      turnIds: scores[index] === null ? [] : [turn.id],
    })),
  };
}

const unscored = scoring([null, null, null, null]);
const completeScore = scoring([25, 25, 20, 15]);

function practice(score: Report["scoring"]): Practice & { report: Report } {
  return {
    roundId, roundNumber: 1, status: "COMPLETED", modelMode: "live", maxTurns: 1,
    turns: [turn],
    report: {
      mode: "live", clearParts: ["说明了语音到日程的转换。"], findings: [], retestTopics: [],
      ...(score === undefined ? {} : { scoring: score }),
    },
  };
}

async function openArchive(
  page: Page,
  initial: Report["scoring"],
  responses: Report["scoring"][] = [completeScore],
  speechEnabled = true,
) {
  let current = practice(initial);
  const requests = { score: 0, history: 0 };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    let json: unknown;
    if (url.pathname === "/api/config") json = { modelMode: "live", speechEnabled };
    else if (url.pathname === "/api/me") json = { id: "synthetic", username: "补评分回归" };
    else if (url.pathname === "/api/practice-history") {
      requests.history++;
      json = [{
        projectId, roundId, roundNumber: 1, name: "语音日程助手", status: "COMPLETED",
        answeredCount: 1, maxTurns: 1, retestCompleted: false,
        startedAt: Date.UTC(2026, 10, 19, 2), interviewTopic: "语音录入", prioritySuggestion: "",
        totalScore: current.report.scoring?.total ?? null,
        hasScoring: current.report.scoring?.dimensions.some(dimension => typeof dimension.score === "number") ?? false,
      }];
    } else if (url.pathname === "/api/training-projects") json = [];
    else if (url.pathname === "/api/training-page") json = { items: [], total: 0, offset: 0, limit: 20, hasMore: false };
    else if (url.pathname === `/api/projects/${projectId}/practice`) {
      expect(request.method()).toBe("GET");
      expect(url.searchParams.get("roundId")).toBe(roundId);
      json = current;
    } else if (url.pathname === `/api/projects/${projectId}/practice/score`) {
      expect(request.method()).toBe("POST");
      expect(request.postDataJSON()).toEqual({ roundId });
      expect(requests.score).toBeLessThan(responses.length);
      current = practice(responses[requests.score++]);
      json = current;
    } else throw new Error("未预期请求：" + url.pathname);
    await route.fulfill({ json });
  });
  await page.goto(archivePath);
  await expect(page.getByRole("heading", { name: "第 1 次面试", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "完整对话" }).getByText(turn.answer, { exact: true })).toBeVisible();
  return requests;
}

for (const initial of [undefined, unscored]) {
  test(`${initial ? "四维全 null" : "缺少 scoring 对象"}时允许补评分并刷新历史`, async ({ page }) => {
    const requests = await openArchive(page, initial);
    const region = page.getByRole("region", { name: "本场评分" });
    const historyReads = requests.history;
    if (initial) await expect(region.getByText("未覆盖", { exact: true })).toHaveCount(4);
    else await expect(region.getByText("未评分", { exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "补生成评分", exact: true })).toBeEnabled();
    await region.getByRole("button", { name: "补生成评分", exact: true }).click();
    await expect(region.getByText(/85\s*\/\s*100/)).toBeVisible();
    await expect(region.getByText("未覆盖", { exact: true })).toHaveCount(0);
    await expect(region.getByRole("button", { name: /生成评分/ })).toHaveCount(0);
    await expect(region.getByRole("alert")).toHaveCount(0);
    expect(requests.score).toBe(1);
    await expect.poll(() => requests.history).toBe(historyReads + 1);
    await page.getByRole("link", { name: "返回项目训练记录" }).click();
    await expect(page.getByText("评分 85 / 100", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "查看报告与对话", exact: true }).click();
    await page.reload();
    await expect(region.getByText(/85\s*\/\s*100/)).toBeVisible();
    await expect(region.getByRole("button", { name: /生成评分/ })).toHaveCount(0);
    expect(requests.score).toBe(1);
  });
}

for (const failedScore of [undefined, unscored]) {
  test(`补评返回${failedScore ? "四维全 null" : "缺少 scoring 对象"}时报错，重试到单维零分才成功`, async ({ page }) => {
    const partialScore = scoring([null, null, null, 0]);
    const requests = await openArchive(page, unscored, [failedScore, partialScore]);
    const region = page.getByRole("region", { name: "本场评分" });
    const historyReads = requests.history;
    await region.getByRole("button", { name: "补生成评分", exact: true }).click();
    await expect(region.getByRole("alert")).toHaveText("评分未生成，请重试。");
    await expect(region.getByRole("button", { name: "重试生成评分", exact: true })).toBeEnabled();
    await expect(region.getByText("未覆盖", { exact: true })).toHaveCount(4);
    expect(requests.score).toBe(1);
    // 无有效维度不能触发成功回调刷新历史。
    expect(requests.history).toBe(historyReads);

    await region.getByRole("button", { name: "重试生成评分", exact: true }).click();
    await expect(region.getByText("0 / 25", { exact: true })).toBeVisible();
    await expect(region.getByText("未覆盖", { exact: true })).toHaveCount(3);
    await expect(region.getByText("未生成总分", { exact: true })).toBeVisible();
    await expect(region.getByRole("alert")).toHaveCount(0);
    await expect(region.getByRole("button", { name: /生成评分/ })).toHaveCount(0);
    expect(requests.score).toBe(2);
    await expect.poll(() => requests.history).toBe(historyReads + 1);
    await page.reload();
    await expect(region.getByText("0 / 25", { exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: /生成评分/ })).toHaveCount(0);
    expect(requests.score).toBe(2);
  });
}

for (const key of keys) {
  test(`仅 ${key} 维度为零分也已有有效评分，不提供补评入口`, async ({ page }) => {
    const partialScore = {
      ...unscored,
      dimensions: unscored.dimensions.map(dimension => dimension.key === key
        ? { ...dimension, score: 0, turnIds: [turn.id] } : dimension),
    };
    const requests = await openArchive(page, partialScore, []);
    const region = page.getByRole("region", { name: "本场评分" });
    await expect(region.getByText("0 / 25", { exact: true })).toBeVisible();
    await expect(region.getByText("未覆盖", { exact: true })).toHaveCount(3);
    await expect(region.getByText("未生成总分", { exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: /生成评分/ })).toHaveCount(0);
    expect(requests.score).toBe(0);
  });
}

test("ASR 未就绪不影响使用已保存回答补评分", async ({ page }) => {
  const requests = await openArchive(page, unscored, [completeScore], false);
  const region = page.getByRole("region", { name: "本场评分" });
  await expect(region.getByRole("button", { name: "补生成评分", exact: true })).toBeEnabled();
  await region.getByRole("button", { name: "补生成评分", exact: true }).click();
  await expect(region.getByText(/85\s*\/\s*100/)).toBeVisible();
  await expect(region.getByRole("button", { name: /生成评分/ })).toHaveCount(0);
  await expect(region.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "完整对话" }).getByText(turn.answer, { exact: true })).toBeVisible();
  expect(requests.score).toBe(1);
});

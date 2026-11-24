import { test, expect, type Page } from "@playwright/test";

function practiceRecords(projectCount = 21, roundCount = 21) {
  return Array.from({ length: projectCount }, (_, projectIndex) => {
    const projectId = `project-${projectIndex + 1}`;
    // 故意按场次升序返回，分页必须发生在项目分组、场次排序之后。
    return Array.from({ length: projectIndex < 2 ? roundCount : 1 }, (_, index) => ({
      projectId,
      name: `分页项目 ${projectIndex + 1}`,
      roundId: `${projectId}-round-${index + 1}`,
      roundNumber: index + 1,
      status: index === 0 ? "FAILED" : "ACTIVE",
      answeredCount: 1,
      maxTurns: 5,
      startedAt: Date.UTC(2026, 10, 19) + index * 1000,
      interviewTopic: `主题 ${projectIndex + 1}-${index + 1}`,
      prioritySuggestion: "",
    }));
  }).flat();
}

async function mockHistory(page: Page) {
  const state = {
    records: practiceRecords(),
    practiceReads: 0,
    legacy: Array.from({ length: 21 }, (_, index) => ({
      id: `legacy-${index}`,
      status: "COMPLETED",
      kind: "DEEP",
      createdAt: Date.UTC(2026, 10, 18),
      project: { id: index === 20 ? "b" : "a", name: index === 20 ? "旧版项目乙" : "旧版项目甲" },
      historyKey: index === 20 ? "key-b" : "key-a",
      answeredCount: 1,
      turnCount: 1,
    })),
    legacyOffsets: [] as number[],
  };
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    let json: unknown;
    if (url.pathname === "/api/config") json = { modelMode: "demo" };
    else if (url.pathname === "/api/me") json = { id: "pagination-user", username: "分页回归" };
    else if (url.pathname === "/api/practice-history") {
      expect(route.request().method()).toBe("GET");
      expect(url.search).toBe("");
      state.practiceReads++;
      json = state.records;
    } else if (url.pathname === "/api/training-projects") {
      json = state.legacy.length ? [{ key: "key-a", name: "旧版项目甲" }, { key: "key-b", name: "旧版项目乙" }] : [];
    } else if (url.pathname === "/api/training-page") {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      expect(limit).toBe(20);
      state.legacyOffsets.push(offset);
      const key = url.searchParams.get("key");
      const records = state.legacy.filter(record => !key || record.historyKey === key);
      json = { items: records.slice(offset, offset + limit), total: records.length, offset, limit, hasMore: offset + limit < records.length };
    } else throw new Error("未预期请求：" + url.pathname);
    await route.fulfill({ json });
  });
  return state;
}

const projectPager = (page: Page) => page.getByRole("group", { name: "项目训练分页", exact: true });
const roundPager = (page: Page) => page.getByRole("group", { name: "面试场次分页", exact: true });

test("21 个项目按 20 条分页，与旧版服务端分页及筛选互不干扰", async ({ page }) => {
  const state = await mockHistory(page);
  await page.goto("/#/history");
  const projects = page.getByRole("region", { name: "项目训练", exact: true });
  const pager = projectPager(page);
  await expect(projects.getByRole("link")).toHaveCount(20);
  await expect(projects.getByRole("heading").first()).toHaveText("分页项目 1");
  await expect(projects.getByRole("heading").last()).toHaveText("分页项目 20");
  await expect(pager).toContainText("第 1 页 · 共 21 条");
  await expect(pager.getByRole("button", { name: "上一页" })).toBeDisabled();
  await expect(pager.getByRole("button", { name: "下一页" })).toBeEnabled();
  const reads = state.practiceReads;

  await page.locator(".history-legacy > summary").click();
  const legacyPager = page.getByLabel("训练记录分页", { exact: true });
  await expect(page.locator(".history-record")).toHaveCount(20);
  await legacyPager.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator(".history-record")).toHaveCount(1);
  await expect(legacyPager).toContainText("第 2 页 · 共 21 条");
  await expect(legacyPager.getByRole("button", { name: "下一页" })).toBeDisabled();
  await expect(pager).toContainText("第 1 页 · 共 21 条");
  await expect(projects.getByRole("link")).toHaveCount(20);

  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(projects.getByRole("link")).toHaveCount(1);
  await expect(projects.getByRole("heading")).toHaveText("分页项目 21");
  await expect(pager).toContainText("第 2 页 · 共 21 条");
  await expect(pager.getByRole("button", { name: "下一页" })).toBeDisabled();
  await expect(legacyPager).toContainText("第 2 页 · 共 21 条");
  await expect(page.locator(".history-record")).toHaveCount(1);

  await legacyPager.getByRole("button", { name: "上一页" }).click();
  await expect(page.locator(".history-record")).toHaveCount(20);
  await legacyPager.getByRole("button", { name: "下一页" }).click();
  await expect(legacyPager).toContainText("第 2 页 · 共 21 条");
  await page.getByRole("combobox", { name: /筛选训练项目/ }).click();
  await page.getByRole("option", { name: "旧版项目甲", exact: true }).click();
  await expect(page.locator(".history-record")).toHaveCount(20);
  await expect(legacyPager).toContainText("第 1 页 · 共 20 条");
  await expect(legacyPager.getByRole("button", { name: "上一页" })).toBeDisabled();
  await expect(pager).toContainText("第 2 页 · 共 21 条");
  await pager.getByRole("button", { name: "上一页" }).click();
  await expect(projects.getByRole("link")).toHaveCount(20);
  await expect(legacyPager).toContainText("第 1 页 · 共 20 条");
  expect(state.legacyOffsets).toEqual([0, 20, 0, 20, 0]);
  expect(state.practiceReads).toBe(reads);

  await pager.getByRole("button", { name: "下一页" }).click();
  await projects.getByRole("link").click();
  await expect(roundPager(page)).toContainText("第 1 页 · 共 1 条");
  await expect(roundPager(page).getByRole("button", { name: "上一页" })).toBeDisabled();
  await expect(roundPager(page).getByRole("button", { name: "下一页" })).toBeDisabled();
  await page.getByRole("link", { name: "返回训练记录", exact: true }).click();
  await expect(pager).toContainText("第 1 页 · 共 21 条");
});

test("21 场面试排序后分页，切换项目归零且只有全局最新场次可续训", async ({ page }) => {
  const state = await mockHistory(page);
  await page.goto("/#/history/project-1");
  const rounds = page.getByRole("region", { name: "面试记录", exact: true });
  const pager = roundPager(page);
  await expect(rounds.getByRole("article")).toHaveCount(20);
  await expect(page.getByText(/共训练 21 次/)).toBeVisible();
  await expect(rounds.getByRole("heading").first()).toHaveText("第 21 次面试");
  await expect(rounds.getByRole("heading").last()).toHaveText("第 2 次面试");
  await expect(pager.getByRole("button", { name: "上一页" })).toBeDisabled();
  await expect(rounds.getByRole("link", { name: "继续训练", exact: true })).toHaveCount(1);
  await expect(rounds.getByRole("article").first().getByRole("link", { name: "继续训练", exact: true }))
    .toHaveAttribute("href", "#/projects/project-1?interview=1&from=history");
  const reads = state.practiceReads;

  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(rounds.getByRole("article")).toHaveCount(1);
  await expect(rounds.getByRole("heading")).toHaveText("第 1 次面试");
  await expect(pager).toContainText("第 2 页 · 共 21 条");
  await expect(pager.getByRole("button", { name: "下一页" })).toBeDisabled();
  await expect(rounds.getByRole("link", { name: /继续训练|恢复训练|重试生成报告|查看进度/ })).toHaveCount(0);
  await expect(rounds.getByRole("link", { name: "查看对话", exact: true }))
    .toHaveAttribute("href", "#/history/project-1/project-1-round-1");
  await pager.getByRole("button", { name: "上一页" }).click();
  await expect(rounds.getByRole("article")).toHaveCount(20);
  await expect(rounds.getByRole("link", { name: "继续训练", exact: true })).toHaveCount(1);
  await pager.getByRole("button", { name: "下一页" }).click();
  expect(state.practiceReads).toBe(reads);

  await page.evaluate(() => { location.hash = "/history/project-2"; });
  await expect(page.getByRole("heading", { name: "分页项目 2", exact: true })).toBeVisible();
  await expect(pager).toContainText("第 1 页 · 共 21 条");
  await expect(rounds.getByRole("article")).toHaveCount(20);
  await expect(rounds.getByRole("heading").first()).toHaveText("第 21 次面试");
  await pager.getByRole("button", { name: "下一页" }).click();
  await page.getByRole("link", { name: "返回训练记录", exact: true }).click();
  await page.getByRole("link", { name: /^分页项目 1 / }).click();
  await expect(pager).toContainText("第 1 页 · 共 21 条");
  await expect(rounds.getByRole("article")).toHaveCount(20);
});

for (const total of [0, 1, 20, 41]) {
  test(`第二页刷新后总数变为 ${total}，项目和场次页码均有效`, async ({ page }) => {
    const state = await mockHistory(page);
    state.legacy = [];
    await page.goto("/#/history");
    await projectPager(page).getByRole("button", { name: "下一页" }).click();
    await expect(projectPager(page)).toContainText("第 2 页 · 共 21 条");
    state.records = practiceRecords(total);
    await page.reload();
    if (total === 0) {
      await expect(page.getByRole("heading", { name: "还没有开始训练" })).toBeVisible();
      await expect(projectPager(page)).toHaveCount(0);
    } else {
      await expect(page.locator(".practice-history-project")).toHaveCount(Math.min(total, 20));
      await expect(projectPager(page)).toContainText(`第 1 页 · 共 ${total} 条`);
      await expect(projectPager(page).getByRole("button", { name: "上一页" })).toBeDisabled();
      await expect(projectPager(page).getByRole("button", { name: "下一页" })).toBeEnabled({ enabled: total > 20 });
    }

    state.records = practiceRecords(1, 21);
    await page.goto("/#/history/project-1");
    await roundPager(page).getByRole("button", { name: "下一页" }).click();
    await expect(roundPager(page)).toContainText("第 2 页 · 共 21 条");
    state.records = practiceRecords(1, total);
    await page.reload();
    if (total === 0) {
      await expect(page.getByRole("heading", { name: "没有找到这个项目的训练记录" })).toBeVisible();
      await expect(roundPager(page)).toHaveCount(0);
    } else {
      await expect(page.locator(".practice-history-round")).toHaveCount(Math.min(total, 20));
      await expect(roundPager(page)).toContainText(`第 1 页 · 共 ${total} 条`);
      await expect(roundPager(page).getByRole("button", { name: "上一页" })).toBeDisabled();
      await expect(roundPager(page).getByRole("button", { name: "下一页" })).toBeEnabled({ enabled: total > 20 });
    }
  });
}

import { test, expect } from "@playwright/test";
import { demoProject } from "../src/api";

test("训练记录分页、服务端筛选与展开后读取原问答", async ({ page }) => {
  const records = Array.from({ length: 21 }, (_, index) => ({
    id: "archive-" + index,
    status: "COMPLETED",
    kind: "DEEP",
    maxTurns: 5,
    createdAt: Date.now() - index,
    project: {
      id: index === 20 ? "b" : "a",
      name: index === 20 ? "项目乙" : "项目甲",
    },
    answeredCount: 1,
    turnCount: 1,
    historyKey: index === 20 ? "key-b" : "key-a",
  }));
  let detailReads = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let json: unknown;
    if (url.pathname === "/api/config")
      json = {
        modelMode: "demo",
        paymentMode: "mock",
        paymentConfigured: false,
      };
    else if (url.pathname === "/api/me")
      json = { id: "synthetic", username: "分页回归" };
    else if (url.pathname === "/api/training-projects")
      json = [
        { key: "key-a", name: "项目甲" },
        { key: "key-b", name: "项目乙" },
      ];
    else if (url.pathname === "/api/training-page") {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      const key = url.searchParams.get("key");
      const selected = records.filter(
        (record) => !key || record.historyKey === key,
      );
      json = {
        items: selected.slice(offset, offset + limit),
        total: selected.length,
        offset,
        limit,
        hasMore: offset + limit < selected.length,
      };
    } else if (url.pathname.startsWith("/api/trainings/")) {
      detailReads++;
      json = {
        turns: [
          {
            id: "turn",
            question: "展开后才读取的问题",
            topic: "验证",
            answer: "保留完整原回答",
          },
        ],
      };
    } else throw new Error("未预期请求：" + url.pathname);
    await route.fulfill({ json });
  });
  await page.goto("/#/history");
  await expect(page.locator(".history-record")).toHaveCount(20);
  expect(detailReads).toBe(0);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".history-record")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.locator(".archive-details summary").click();
  await expect(page.getByText("保留完整原回答", { exact: true })).toBeVisible();
  expect(detailReads).toBe(1);
  await page.getByRole("combobox", { name: /筛选训练项目/ }).click();
  await page.getByRole("option", { name: "项目甲", exact: true }).click();
  await expect(page.locator(".history-record")).toHaveCount(20);
  await expect(
    page.getByRole("button", { name: "上一页", exact: true }),
  ).toBeDisabled();
});

for (const width of [1440, 390]) {
  test(`多轮首题变化、完整问答刷新与项目筛选 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const post = async (path: string, data: unknown = {}) => {
      const response = await page.request.post("/api" + path, {
        headers: { Origin: new URL(test.info().project.use.baseURL || "http://localhost:5174").origin },
        data,
      });
      expect(response.ok()).toBeTruthy();
      return response.json();
    };
    await post("/auth/register", {
      username: "history-" + crypto.randomUUID(),
      password: "synthetic-test-password",
    });
    const project = async (name: string) => {
      let p = await post("/projects", {
        ...demoProject,
        name,
        resume: name + "：我负责接口与并发测试。",
      });
      p = await post("/projects/" + p.id + "/extract");
      return post("/projects/" + p.id + "/confirm", {
        version: p.version,
        facts: p.facts,
      });
    };
    const p = await project("多轮合成预约项目");
    const order = await post("/orders", { requestKey: crypto.randomUUID() });
    await post("/orders/" + order.id + "/mock-pay");
    const first = await post("/trainings", {
      projectId: p.id,
      requestKey: crypto.randomUUID(),
    });
    const firstQuestion = first.turns[0].question;
    await post("/trainings/" + first.id + "/answer", {
      turnId: first.turns[0].id,
      answer: "第一轮：我负责预约接口，实际验证结果待补充。",
    });
    const second = await post("/trainings", {
      projectId: p.id,
      requestKey: crypto.randomUUID(),
    });
    expect(second.turns[0].question).not.toBe(firstQuestion);
    await post("/trainings/" + second.id + "/answer", {
      turnId: second.turns[0].id,
      answer: "第二轮：我补充了错误恢复说明，尚未记录测试结果。",
    });
    const other = await project("另一份合成项目");
    await post("/trainings", {
      projectId: other.id,
      requestKey: crypto.randomUUID(),
    });
    await page.goto("/#/history");
    await expect(page.locator(".history-record")).toHaveCount(3);
    await page.getByRole("combobox", { name: /筛选训练项目/ }).click();
    await page.getByRole("option", { name: first.project.name, exact: true }).click();
    await expect(page.locator(".history-record")).toHaveCount(2);
    await page.locator(".history-record summary").first().click();
    await page.locator(".history-record summary").nth(1).click();
    await expect(page.getByText(firstQuestion, { exact: true })).toBeVisible();
    await expect(
      page.getByText(second.turns[0].question, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("第一轮：我负责预约接口，实际验证结果待补充。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("第二轮：我补充了错误恢复说明，尚未记录测试结果。", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/training-history-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.reload();
    await expect(page.locator(".history-record")).toHaveCount(3);
    await page.getByRole("combobox", { name: /筛选训练项目/ }).click();
    await page.getByRole("option", { name: first.project.name, exact: true }).click();
    await page.locator(".history-record summary").nth(1).click();
    await expect(
      page.getByText("第一轮：我负责预约接口，实际验证结果待补充。", {
        exact: true,
      }),
    ).toBeVisible();
  });
}

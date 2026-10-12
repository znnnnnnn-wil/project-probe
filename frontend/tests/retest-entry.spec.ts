import { test, expect, type Page } from "@playwright/test";
import { demoProject } from "../src/api";
import type { Training } from "../src/types";
async function seed(page: Page) {
  const headers = {
    Origin: new URL(test.info().project.use.baseURL || "http://localhost:5174").origin,
  };
  const api = page.context().request;
  async function post(path: string, data: unknown = {}) {
    const r = await api.post("/api" + path, { headers, data });
    expect(r.ok()).toBeTruthy();
    return r.json();
  }
  await post("/auth/register", {
    username: "entry-" + crypto.randomUUID(),
    password: "synthetic-test-password",
  });
  let project = await post("/projects", demoProject);
  project = await post("/projects/" + project.id + "/extract");
  project = await post("/projects/" + project.id + "/confirm", {
    version: project.version,
    facts: project.facts,
  });
  async function deep() {
    const order = await post("/orders", { requestKey: crypto.randomUUID() });
    await post("/orders/" + order.id + "/mock-pay");
    const t = await post("/trainings", {
      projectId: project.id,
      requestKey: crypto.randomUUID(),
    });
    await post("/trainings/" + t.id + "/answer", {
      turnId: t.turns[0].id,
      answer: "我只负责预约接口，其他部分需要交接确认。",
    });
    return post("/trainings/" + t.id + "/finish");
  }
  const first: Training = await deep();
  return { project, first, deep, post, headers };
}
test("同一项目两份训练包的复测入口相互独立", async ({ page }) => {
  const { project, first, deep, post } = await seed(page);
  const second: Training = await deep();
  const retest: Training = await post("/trainings", {
    projectId: project.id,
    parentId: first.id,
    requestKey: crypto.randomUUID(),
  });
  await post("/trainings/" + retest.id + "/finish");
  await page.goto("/#/projects/" + project.id);
  const cards = page.locator(".retest-entry");
  await expect(cards).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "查看复测结果", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "开始关联复测", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "开始关联复测", exact: true }).click();
  await expect(page).toHaveURL(/#\/trainings\/[a-f0-9-]+$/);
  const freshId = page.url().split("/").pop();
  const value = await (
    await page.context().request.get("/api/trainings/" + freshId)
  ).json();
  expect(value.parentId).toBe(second.id);
  expect(value.packageId).not.toBe(retest.packageId);
});
test("失败的无首题复测可以从继续入口恢复生成", async ({ page }) => {
  const { project, first, post } = await seed(page);
  const retest: Training = await post("/trainings", {
    projectId: project.id,
    parentId: first.id,
    requestKey: crypto.randomUUID(),
  });
  let failure = true;
  await page.route("**/api/trainings/" + retest.id, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: failure
        ? {
            ...data,
            status: "FAILED",
            turns: [],
            error: "合成模型首题失败，记录已保存。",
          }
        : data,
    });
  });
  await page.route(
    "**/api/trainings/" + retest.id + "/retry",
    async (route) => {
      failure = false;
      await route.continue();
    },
  );
  await page.goto("/#/projects/" + project.id);
  await page.getByRole("button", { name: "继续复测", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "生成遇到问题，回答仍在" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重试 / 恢复生成" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "重试 / 恢复生成" }).click();
  await expect(page.getByLabel("你的回答", { exact: true })).toBeVisible();
  const items: Training[] = await (
    await page.context().request.get("/api/trainings")
  ).json();
  expect(items.filter((t) => t.parentId === first.id)).toHaveLength(1);
});
test("已返还复测显示可重新开始，未核对材料也可以继续已有复测", async ({
  page,
}) => {
  const { project, first, post } = await seed(page);
  const retest: Training = await post("/trainings", {
    projectId: project.id,
    parentId: first.id,
    requestKey: crypto.randomUUID(),
  });
  await page.context().request.put("/api/projects/" + project.id, {
    headers: { Origin: new URL(test.info().project.use.baseURL || "http://localhost:5174").origin },
    data: { ...project, verification: "修订但尚未重新核对" },
  });
  await page.goto("/#/projects/" + project.id);
  await expect(
    page.getByRole("button", { name: "继续复测", exact: true }),
  ).toBeEnabled();
  // 返还状态的界面测试使用响应夹具；真实返还/重新预留由后端事务回归覆盖。
  await page.route("**/api/trainings", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const data: Training[] = await response.json();
    await route.fulfill({
      response,
      json: data.map((t) =>
        t.id === first.id
          ? {
              ...t,
              retestEntry: {
                state: "AVAILABLE",
                returned: true,
                packageId: retest.packageId,
              },
            }
          : t.id === retest.id
            ? { ...t, status: "REFUNDED" }
            : t,
      ),
    });
  });
  await page.reload();
  await expect(
    page.getByText("上次故障复测次数已返还，可以重新开始。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始关联复测", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "提取项目事实", exact: true }).click();
  await page.getByRole("button", { name: "保存核对结果" }).click();
  await expect(
    page.getByRole("button", { name: "开始关联复测", exact: true }),
  ).toBeEnabled();
});

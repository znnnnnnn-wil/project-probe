import { test, expect, type Page } from "@playwright/test";
import { demoProject } from "../src/api";

const id = "11111111-1111-4111-8111-111111111111";
async function fixture(page: Page) {
  let state = {
    id,
    kind: "DEEP",
    status: "PENDING",
    project: { ...demoProject, id: "synthetic-project" },
    turns: [
      {
        id: "turn-1",
        question: "旧问题",
        topic: "验证",
        answer: "已保存的回答",
      },
    ],
    maxTurns: 5,
    modelMode: "demo",
    leaseUntil: 0,
    createdAt: Date.now(),
    focus: "验证",
    interviewFacts: [],
    packageId: "synthetic-package",
  };
  let reads = 0;
  let release: () => void = () => {};
  let held = false;
  let completed = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let json: unknown;
    if (path === "/api/config")
      json = {
        modelMode: "demo",
        paymentMode: "mock",
        paymentConfigured: false,
      };
    else if (path === "/api/me")
      json = { id: "synthetic-user", username: "轮询回归" };
    else if (path === "/api/trainings/" + id && request.method() === "GET") {
      reads++;
      json = structuredClone(state);
      if (reads === 2) {
        held = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        try {
          await route.fulfill({ json });
        } catch {
          /* 客户端应取消这次读取。 */
        }
        completed = true;
        return;
      }
    } else if (path === "/api/trainings/" + id + "/retry") {
      state = {
        ...state,
        status: "ACTIVE",
        turns: [
          {
            id: "turn-2",
            question: "恢复后的新问题",
            topic: "验证",
            answer: "",
          },
        ],
      };
      json = state;
    } else if (path === "/api/projects" || path === "/api/trainings") json = [];
    else if (path === "/api/training-overview")
      json = { items: [], activeCount: 0, completedCount: 0 };
    else if (path === "/api/shop")
      json = {
        mode: "mock",
        configured: false,
        orders: [],
        packages: [],
        product: {},
      };
    else throw new Error("未预期请求：" + request.method() + " " + path);
    await route.fulfill({ json });
  });
  return {
    held: () => held,
    completed: () => completed,
    release: () => release(),
  };
}

test("慢轮询不会覆盖恢复生成后的新问题", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/#/trainings/" + id);
  await expect.poll(f.held).toBe(true);
  await page.getByRole("button", { name: "重试 / 恢复生成" }).click();
  await expect(
    page.getByRole("heading", { name: "恢复后的新问题" }),
  ).toBeVisible();
  f.release();
  await expect.poll(f.completed).toBe(true);
  await expect(
    page.getByRole("heading", { name: "恢复后的新问题" }),
  ).toBeVisible();
  await expect(page.getByLabel("你的回答", { exact: true })).toBeVisible();
});

test("离开训练时取消未完成的轮询", async ({ page }) => {
  const f = await fixture(page);
  let aborted = false;
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/trainings/" + id)
      aborted = true;
  });
  await page.goto("/#/trainings/" + id);
  await expect.poll(f.held).toBe(true);
  await page.getByRole("link", { name: "我的项目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的项目", exact: true }),
  ).toBeVisible();
  await expect.poll(() => aborted).toBe(true);
  f.release();
  await expect.poll(f.completed).toBe(true);
  await expect(page).toHaveURL(/#\/projects$/);
});

import { expect, test } from "@playwright/test";

test("免登录短体验随初答改变追问，并区分补充细节和实际验证", async ({ page }) => {
  await page.route("**/api/**", route => route.abort());
  await page.goto("/#/experience?mode=quick");

  await page.getByRole("button", { name: "示例：只讲约束" }).click();
  await page.getByRole("button", { name: "看下一问" }).click();
  await expect(page.getByRole("heading", { name: /会向调用方返回什么/ })).toBeVisible();
  await expect(page.getByText("已定位到唯一约束，还没看到冲突如何反馈给调用方。")).toBeVisible();
  await page.getByRole("textbox", { name: "补答" }).fill("接口返回 409，提示座位已被预约。");
  await page.getByRole("button", { name: "看回答对照" }).click();
  await expect(page.getByRole("heading", { name: "两次回答对照" })).toBeVisible();
  await expect(page.getByText(/冲突响应 · “接口返回 409”/)).toBeVisible();

  await page.getByRole("button", { name: "试试另一种回答" }).click();
  await page.getByRole("button", { name: "示例：讲清冲突响应" }).click();
  await page.getByRole("button", { name: "看下一问" }).click();
  await expect(page.getByRole("heading", { name: /构造一个并发用例/ })).toBeVisible();
  await page.getByRole("textbox", { name: "补答" }).fill("两个请求并发预约同一座位。预期只有一笔有效预约，还没跑测试。");
  await page.getByRole("button", { name: "看回答对照" }).click();
  await expect(page.getByText(/测试输入 · “两个请求并发预约同一座位”/)).toBeVisible();
  await expect(page.getByText(/预期结果 · “预期只有一笔有效预约”/)).toBeVisible();
  await expect(page.getByText(/实际实现和测试结果仍需核对/)).toBeVisible();

  await page.getByRole("button", { name: "试试另一种回答" }).click();
  await page.getByRole("textbox", { name: "初答" }).fill("加了数据库唯一约束。现在不会返回 409。");
  await page.getByRole("button", { name: "看下一问" }).click();
  await expect(page.getByRole("heading", { name: /会向调用方返回什么/ })).toBeVisible();
});

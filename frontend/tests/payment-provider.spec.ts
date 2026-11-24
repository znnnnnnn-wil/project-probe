import { expect, test } from "@playwright/test";

const projectId = "22222222-2222-4222-8222-222222222222";

test("爱猹收返回后刷新次数，继续同一个训练请求", async ({ page }) => {
  const requestKeys: string[] = [];
  let purchased = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/config")
      return route.fulfill({
        json: {
          modelMode: "demo",
          paymentProvider: "watcha",
          paymentMode: "watcha",
          paymentConfigured: true,
        },
      });
    if (path === "/api/me")
      return route.fulfill({ json: { id: "buyer", username: "沙箱买家" } });
    if (path === `/api/projects/${projectId}`)
      return route.fulfill({
        json: {
          id: projectId,
          name: "测试项目",
          targetRole: "Java 后端实习",
          stack: "",
          background: "",
          resume: "",
          responsibility: "",
          architecture: "",
          implementation: "",
          problems: "",
          verification: "",
          materials: "",
          facts: [],
          factsConfirmed: true,
          version: 1,
        },
      });
    if (path === "/api/billing/watcha")
      return route.fulfill({
        json: {
          remaining: purchased ? 10 : 0,
          purchaseUrl: "https://pay.watcha.cn/example-checkout",
        },
      });
    if (path === "/api/trainings" && request.method() === "POST") {
      requestKeys.push(request.postDataJSON().requestKey);
      return purchased
        ? route.fulfill({ json: { id: "started-training", status: "ACTIVE" } })
        : route.fulfill({ status: 402, json: { message: "训练次数不足" } });
    }
    if (path === "/api/trainings") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { message: "未预期的请求" } });
  });

  await page.goto(`/#/projects/${projectId}`);
  await page.getByRole("button", { name: "开始深挖训练" }).click();
  await expect(page.getByRole("alert")).toContainText("训练次数不足");
  await page.getByRole("link", { name: "查看训练包" }).click();
  await expect(
    page.getByRole("link", { name: "前往爱猹收购买" }),
  ).toHaveAttribute("target", "_blank");
  await expect(page.getByText("0 次可用")).toBeVisible();
  purchased = true;
  await page.getByRole("button", { name: "刷新训练次数" }).click();
  await expect(page.getByText("10 次可用")).toBeVisible();
  await page.getByRole("link", { name: "返回原页面" }).click();
  await page.reload();
  await page.getByRole("button", { name: "开始深挖训练" }).click();
  await expect(page).toHaveURL(/#\/trainings\/started-training$/);
  expect(requestKeys).toHaveLength(2);
  expect(requestKeys[0]).toBe(requestKeys[1]);
});

test("旧版支付页面可以继续模拟付款并显示订单交付", async ({ page }) => {
  const order = {
    id: projectId,
    amount_cents: 990,
    mode: "mock",
    status: "PENDING",
    created_at: Date.now(),
  };
  let created = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({
        json: {
          modelMode: "demo",
          paymentProvider: "legacy",
          paymentMode: "mock",
          paymentConfigured: true,
        },
      });
    if (path === "/api/me")
      return route.fulfill({ json: { id: "buyer", username: "模拟买家" } });
    if (path === "/api/shop")
      return route.fulfill({
        json: {
          mode: "mock",
          configured: true,
          orders: created ? [order] : [],
          packages: [],
          product: {
            name: "面试训练包",
            amountCents: 990,
            description: "共 10 次",
          },
        },
      });
    if (path === "/api/orders") {
      created = true;
      return route.fulfill({ json: order });
    }
    if (path === `/api/orders/${order.id}/mock-pay`) {
      order.status = "PAID";
      return route.fulfill({ json: order });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/#/shop");
  await page.getByRole("button", { name: "创建模拟订单" }).click();
  await page.getByRole("button", { name: "模拟支付成功" }).click();
  await expect(page.getByText(/已确认，权益已发放/)).toBeVisible();
});

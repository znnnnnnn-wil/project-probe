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

test("访客可以从首页进入训练包，登录后完成模拟购买", async ({ page }) => {
  const order = {
    id: projectId,
    amount_cents: 90,
    mode: "mock",
    status: "PENDING",
    created_at: Date.now(),
  };
  let created = false;
  let signedIn = false;
  let shopRequests = 0;
  const buyer = { id: "buyer", username: "模拟买家" };
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
      return signedIn ? route.fulfill({ json: buyer }) : route.fulfill({ status: 401 });
    if (path === "/api/auth/login") {
      signedIn = true;
      return route.fulfill({ json: buyer });
    }
    if (path === "/api/shop") {
      shopRequests++;
      return route.fulfill({
        json: {
          mode: "mock",
          configured: true,
          orders: created ? [order] : [],
          packages: [],
          product: {
            name: "面试训练包",
            amountCents: 90,
            description: "共 10 次",
          },
        },
      });
    }
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
  await page.goto("/#/");
  await page.getByRole("link", { name: "训练包与订单", exact: true }).click();
  await expect(page.getByText("登录或注册后继续购买训练包", { exact: false })).toBeVisible();
  expect(shopRequests).toBe(0);
  await page.getByRole("button", { name: "已有账号？去登录" }).click();
  await page.getByLabel("用户名", { exact: true }).fill(buyer.username);
  await page.getByLabel("密码", { exact: true }).fill("synthetic-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/#\/shop$/);
  await expect(page.locator(".product-list .price")).toHaveText(/0\.90/);
  await expect(page.getByRole("heading", { name: "永久训练套餐", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "创建模拟订单" }).click();
  await page.getByRole("button", { name: "模拟支付成功" }).click();
  await expect(page.getByText(/已确认，权益已发放/)).toBeVisible();
});

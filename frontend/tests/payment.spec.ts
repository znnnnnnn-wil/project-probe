import { test, expect, type Page } from "@playwright/test";
import { paymentUrl } from "../src/payment";

const id = "11111111-1111-4111-8111-111111111111";
async function fixture(
  page: Page,
  mode: string,
  configured = true,
  operationsEnabled = false,
) {
  const packages: {
    id: string;
    order_id: string;
    deep_used: boolean;
    retest_used: boolean;
  }[] = [];
  const order = {
    id,
    mode,
    status: "PENDING",
    amount_cents: 1234,
    created_at: Date.now(),
    can_operate: true,
    query_status: "NOT_QUERIED",
  };
  const calls: string[] = [];
  let queryFails = false;
  let formHtml =
    '<form method="post" action="https://openapi.alipay.com.evil.test/gateway.do"><input type="hidden" name="biz_content" value="synthetic"></form>';
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push(request.method() + " " + path);
    let json: unknown;
    if (path === "/api/config")
      json = {
        modelMode: "demo",
        paymentMode: mode,
        paymentConfigured: configured,
      };
    else if (path === "/api/me")
      json = { id: "synthetic-user", username: "支付回归" };
    else if (path === "/api/shop")
      json = {
        mode,
        configured,
        operationsEnabled,
        configurationIssues: configured
          ? []
          : ["APP_ID 未填写", "支付宝公钥缺失"],
        product: {
          name: "项目深挖训练包",
          amountCents: 1234,
          description: "合成商品",
        },
        orders: [order],
        packages,
      };
    else if (path.endsWith("/checkout")) json = { formHtml };
    else if (path.endsWith("/sync")) {
      if (queryFails) {
        order.query_status = "QUERY_FAILED";
        await route.fulfill({
          status: 503,
          json: { message: "支付宝查询未能确认付款，请重试" },
        });
        return;
      }
      json = order;
    } else if (path === "/api/orders/" + id) json = order;
    else throw new Error("支付测试出现未预期接口：" + path);
    await route.fulfill({ json });
  });
  return {
    order,
    calls,
    packages,
    fail: (value: boolean) => {
      queryFails = value;
    },
    form: (value: string) => {
      formHtml = value;
    },
  };
}

test("关单入口遵守服务端开关，并在确认后才发送请求", async ({ page }) => {
  const f = await fixture(page, "sandbox", true, true);
  await page.route(`**/api/orders/${id}/close`, async (route) => {
    f.calls.push("POST /api/orders/" + id + "/close");
    f.order.status = "CLOSED";
    await route.fulfill({ json: f.order });
  });
  await page.goto("/#/shop");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "关闭未付款订单" }).click();
  expect(f.calls.some((call) => call.endsWith("/close"))).toBe(false);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "关闭未付款订单" }).click();
  await expect(page.getByText("交易已关闭，未发放权益")).toBeVisible();
  expect(f.calls.filter((call) => call.endsWith("/close"))).toHaveLength(1);
});

test("未使用训练包退款需确认，结果未明时保留查询入口", async ({ page }) => {
  const f = await fixture(page, "sandbox", true, true);
  f.order.status = "PAID";
  f.packages.push({
    id: "synthetic-package",
    order_id: id,
    deep_used: false,
    retest_used: false,
  });
  await page.route(`**/api/orders/${id}/cash-refund`, async (route) => {
    f.calls.push("POST /api/orders/" + id + "/cash-refund");
    f.order.status = "REFUNDING";
    await route.fulfill({ json: f.order });
  });
  await page.route(`**/api/orders/${id}/refund-query`, async (route) => {
    f.calls.push("POST /api/orders/" + id + "/refund-query");
    f.order.status = "CASH_REFUNDED";
    await route.fulfill({ json: f.order });
  });
  await page.goto("/#/shop");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "申请未使用训练包退款" }).click();
  expect(f.calls.some((call) => call.endsWith("/cash-refund"))).toBe(false);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "申请未使用训练包退款" }).click();
  await expect(
    page.getByText("退款处理中或待确认，剩余权益已暂停"),
  ).toBeVisible();
  await page.getByRole("button", { name: "查询退款状态" }).click();
  await expect(
    page.getByText("现金退款已确认，训练包不可继续使用"),
  ).toBeVisible();
});

for (const mode of ["sandbox", "production"]) {
  test(`${mode} 商品、服务端价格与跳转白名单`, async ({ page }) => {
    const f = await fixture(page, mode);
    await page.goto("/#/shop");
    await expect(page.locator(".price")).toContainText("12.34");
    await expect(
      page.getByRole("button", { name: "模拟支付成功" }),
    ).toHaveCount(0);
    const before = page.url();
    await page
      .getByRole("button", {
        name: mode === "sandbox" ? "前往官方沙箱" : "前往支付宝付款",
      })
      .click();
    await expect(
      page.getByText("支付地址不符合当前环境，已阻止跳转"),
    ).toBeVisible();
    expect(page.url()).toBe(before);
    expect(f.calls.some((v) => v.endsWith("/mock-pay"))).toBe(false);
  });
}

test("过期订单关闭付款入口，保留查询失败重试，并允许真实付款确认后展示权益", async ({
  page,
}) => {
  const f = await fixture(page, "sandbox");
  f.order.status = "EXPIRED";
  f.order.query_status = "QUERY_FAILED";
  await page.goto("/#/shop");
  await expect(page.getByRole("button", { name: "前往官方沙箱" })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("订单已过期，付款状态待确认，可重试查询"),
  ).toBeVisible();
  await page.getByRole("button", { name: "查询支付宝状态" }).click();
  expect(f.calls).toContain("POST /api/orders/" + id + "/sync");
  expect(f.calls.some((c) => c.endsWith("/checkout"))).toBe(false);
  f.order.status = "PAID";
  f.order.query_status = "PAID";
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("已确认，权益已发放")).toBeVisible();
});

test("固定域名区分沙箱和正式，拒绝伪造域名及 URL", () => {
  for (const [mode, host] of [
    ["sandbox", "openapi-sandbox.dl.alipaydev.com"],
    ["production", "openapi.alipay.com"],
  ]) {
    expect(
      paymentUrl(`https://${host}/gateway.do?sign=synthetic`, mode),
    ).toContain(host);
    for (const url of [
      `http://${host}/gateway.do`,
      `https://${host}.evil.test/gateway.do`,
      `https://user@${host}/gateway.do`,
      `https://${host}:8443/gateway.do`,
      `https://${host}/gateway.do#x`,
      `https://${host}/other`,
      mode === "sandbox"
        ? "https://openapi.alipay.com/gateway.do"
        : "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
    ])
      expect(() => paymentUrl(url, mode)).toThrow();
  }
});

test("正式配置缺失明确显示且不回退模拟", async ({ page }) => {
  await fixture(page, "production", false);
  await page.goto("/#/shop");
  await expect(page.getByText("APP_ID 未填写")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "前往支付宝付款" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "模拟支付成功" })).toHaveCount(
    0,
  );
});

test("返回参数不能发权益；查询失败可重试，未支付、关闭和已确认均依据服务端", async ({
  page,
}) => {
  const f = await fixture(page, "sandbox");
  f.fail(true);
  await page.goto(
    `/payment-return?probe_order=${id}&trade_status=TRADE_SUCCESS&total_amount=0.01&out_trade_no=forged`,
  );
  await expect(
    page.getByRole("heading", { name: "查询失败，尚未确认付款，可重试" }),
  ).toBeVisible();
  expect(
    f.calls.filter((v) => v.includes("POST") && !v.endsWith("/sync")),
  ).toEqual([]);
  f.fail(false);
  f.order.query_status = "WAIT_BUYER_PAY";
  await page.getByRole("button", { name: "重新查询订单状态" }).click();
  await expect(
    page.getByRole("heading", { name: "等待买家付款" }),
  ).toBeVisible();
  f.order.status = "CLOSED";
  await page.getByRole("button", { name: "重新查询订单状态" }).click();
  await expect(
    page.getByRole("heading", { name: "交易已关闭，未发放权益" }),
  ).toBeVisible();
  f.order.status = "PAID";
  await page.getByRole("button", { name: "重新查询订单状态" }).click();
  await expect(
    page.getByRole("heading", { name: "已确认，权益已发放" }),
  ).toBeVisible();
  await expect(page.getByText("订单金额 ¥12.34")).toBeVisible();
});

test("过期订单返回页重新查询支付宝并恢复已付款状态", async ({ page }) => {
  const f = await fixture(page, "sandbox");
  f.order.status = "EXPIRED";
  f.fail(true);
  await page.goto(`/payment-return?probe_order=${id}`);
  await expect(
    page.getByRole("heading", {
      name: "订单已过期，付款状态待确认，可重试查询",
    }),
  ).toBeVisible();
  const before = f.calls.filter((c) => c.endsWith("/sync")).length;
  f.fail(false);
  await page.route(`**/api/orders/${id}/sync`, async (route) => {
    f.calls.push("POST /api/orders/" + id + "/sync");
    f.order.status = "PAID";
    f.order.query_status = "PAID";
    await route.fulfill({ json: f.order });
  });
  await page.getByRole("button", { name: "重新查询订单状态" }).click();
  await expect(
    page.getByRole("heading", { name: "已确认，权益已发放" }),
  ).toBeVisible();
  expect(f.calls.filter((c) => c.endsWith("/sync")).length).toBe(before + 1);
  expect(
    f.calls.some((c) => c.endsWith("/checkout") || c.endsWith("/mock-pay")),
  ).toBe(false);
});

test("模拟返回页不请求支付宝、不自动模拟成功", async ({ page }) => {
  const f = await fixture(page, "mock");
  await page.goto(
    `/payment-return?probe_order=${id}&trade_status=TRADE_SUCCESS`,
  );
  await expect(
    page.getByRole("heading", { name: "等待支付确认" }),
  ).toBeVisible();
  expect(f.calls.some((v) => v.startsWith("POST"))).toBe(false);
});

test("支付 POST 表单安全重建，忽略返回脚本和事件属性", async ({ page }) => {
  const executed: string[] = [];
  await page
    .context()
    .exposeFunction("recordUnsafePaymentScript", () =>
      executed.push("executed"),
    );
  const f = await fixture(page, "sandbox");
  f.form(
    '<form method="post" action="https://openapi-sandbox.dl.alipaydev.com/gateway.do"><input type="hidden" name="biz_content" value="synthetic" onfocus="window.recordUnsafePaymentScript()"><input type="hidden" name="sign" value="synthetic-sign"></form><script>window.recordUnsafePaymentScript()</script>',
  );
  let method = "",
    data = "";
  await page
    .context()
    .route(
      "https://openapi-sandbox.dl.alipaydev.com/gateway.do**",
      async (route) => {
        method = route.request().method();
        data = route.request().postData() || "";
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: "<p>合成支付网关，不是真实付款</p>",
        });
      },
    );
  await page.goto("/#/shop");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "前往官方沙箱" }).click();
  const popup = await popupPromise;
  await expect(popup.getByText("合成支付网关，不是真实付款")).toBeVisible();
  await expect(page).toHaveURL(/#\/shop$/);
  expect(method).toBe("POST");
  expect(data).toContain("biz_content=synthetic");
  expect(executed).toEqual([]);
});

const gatewayForm =
  '<form method="post" action="https://openapi-sandbox.dl.alipaydev.com/gateway.do"><input type="hidden" name="biz_content" value="synthetic"><input type="hidden" name="sign" value="synthetic-sign"></form>';
async function automaticFixture(page: Page) {
  const f = await fixture(page, "sandbox");
  f.form(gatewayForm);
  let creates = 0;
  await page.route("**/api/orders", async (route) => {
    creates++;
    await route.fulfill({ json: f.order });
  });
  await page
    .context()
    .route(
      "https://openapi-sandbox.dl.alipaydev.com/gateway.do**",
      async (route) => {
        expect(route.request().method()).toBe("POST");
        expect(route.request().postData()).toContain("sign=synthetic-sign");
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: "<p>合成二维码页</p>",
        });
      },
    );
  return { ...f, creates: () => creates };
}

for (const width of [1440, 390]) {
  test(`创建订单自动打开收银台、通知确认后关闭并恢复原页 ${width}`, async ({
    page,
  }) => {
    const f = await automaticFixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/shop");
    const popupPromise = page.waitForEvent("popup");
    await page
      .getByRole("button", { name: "创建沙箱订单", exact: true })
      .click();
    const popup = await popupPromise;
    await expect(popup.getByText("合成二维码页")).toBeVisible();
    await expect(page).toHaveURL(/#\/shop$/);
    expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
    expect(f.creates()).toBe(1);
    expect(f.calls.filter((call) => call.endsWith("/checkout"))).toHaveLength(
      1,
    );
    await page.screenshot({
      path: `test-results/payment-waiting-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    f.order.status = "PAID";
    await expect(
      page.getByText("支付已确认，训练权益已到账。", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect.poll(() => popup.isClosed()).toBe(true);
    await expect(page.locator(".orders")).toContainText("已确认，权益已发放");
    expect(f.calls.some((call) => call.endsWith("/mock-pay"))).toBe(false);
  });
}

test("收银台被拦截时保留已创建订单，不静默跳走或重复创建", async ({ page }) => {
  const f = await automaticFixture(page);
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto("/#/shop");
  await page.getByRole("button", { name: "创建沙箱订单", exact: true }).click();
  await expect(
    page.getByText(
      "浏览器拦截了收银台窗口，订单已保留，请允许弹窗后点击付款重试。",
      { exact: true },
    ),
  ).toBeVisible();
  expect(f.creates()).toBe(1);
  expect(f.calls.some((call) => call.endsWith("/checkout"))).toBe(false);
  await expect(
    page.getByRole("button", { name: "前往官方沙箱", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/shop$/);
});

test("查询失败不视为付款成功，手动关闭收银台后仍继续核对", async ({ page }) => {
  const f = await automaticFixture(page);
  f.fail(true);
  await page.goto("/#/shop");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "创建沙箱订单", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByText("合成二维码页")).toBeVisible();
  await expect
    .poll(() => f.calls.filter((call) => call.endsWith("/sync")).length)
    .toBe(1);
  await expect(
    page.getByText("支付已确认，训练权益已到账。", { exact: true }),
  ).toHaveCount(0);
  await popup.close();
  f.order.status = "PAID";
  await page.bringToFront();
  await expect(
    page.getByText("支付已确认，训练权益已到账。", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
});

test("官方返回页只在服务端确认后自动回到订单页", async ({ page }) => {
  const f = await fixture(page, "sandbox");
  await page.goto(
    `/payment-return?probe_order=${id}&trade_status=TRADE_SUCCESS`,
  );
  await expect(
    page.getByRole("heading", { name: "等待支付确认" }),
  ).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page).toHaveURL(/payment-return/);
  f.order.status = "PAID";
  await page.getByRole("button", { name: "重新查询订单状态" }).click();
  await expect(page).toHaveURL(/\/#\/shop$/, { timeout: 5000 });
  await expect(page.locator(".orders")).toContainText("已确认，权益已发放");
});

test("没有通知时由服务端查询确认，付款后自动返回原项目", async ({ page }) => {
  const f = await automaticFixture(page);
  const projectId = "22222222-2222-4222-8222-222222222222";
  await page.addInitScript(
    (project) => sessionStorage.setItem("purchase:project", project),
    projectId,
  );
  await page.route(`**/api/projects/${projectId}`, (route) =>
    route.fulfill({
      json: {
        id: projectId,
        name: "合成购买来源",
        responsibility: "合成职责",
        resume: "合成原文",
        facts: [],
        factsConfirmed: false,
        version: 1,
      },
    }),
  );
  await page.route(
    /\/api\/trainings(?:\?summary=true(?:&project=[^&]+)?)?$/,
    (route) => route.fulfill({ json: [] }),
  );
  await page.route(`**/api/orders/${id}/sync`, async (route) => {
    f.calls.push("POST /api/orders/" + id + "/sync");
    f.order.status = "PAID";
    await route.fulfill({ json: f.order });
  });
  await page.goto("/#/shop");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "创建沙箱订单", exact: true }).click();
  const popup = await popupPromise;
  await expect(page).toHaveURL(new RegExp("#/projects/" + projectId + "$"));
  await expect.poll(() => popup.isClosed()).toBe(true);
  expect(f.calls.filter((call) => call.endsWith("/sync"))).toHaveLength(1);
  expect(f.creates()).toBe(1);
});

test("刷新原页面恢复待支付核对，不重建订单或重开收银台", async ({ page }) => {
  const f = await automaticFixture(page);
  await page.goto("/#/shop");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "创建沙箱订单", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByText("合成二维码页")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "创建沙箱订单", exact: true }),
  ).toBeDisabled();
  f.order.status = "PAID";
  await expect(
    page.getByText("支付已确认，训练权益已到账。", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  expect(f.creates()).toBe(1);
  expect(f.calls.filter((call) => call.endsWith("/checkout"))).toHaveLength(1);
  await popup.close();
});

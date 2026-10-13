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
  await page.exposeFunction("recordUnsafePaymentScript", () =>
    executed.push("executed"),
  );
  const f = await fixture(page, "sandbox");
  f.form(
    '<form method="post" action="https://openapi-sandbox.dl.alipaydev.com/gateway.do"><input type="hidden" name="biz_content" value="synthetic" onfocus="window.recordUnsafePaymentScript()"><input type="hidden" name="sign" value="synthetic-sign"></form><script>window.recordUnsafePaymentScript()</script>',
  );
  let method = "",
    data = "";
  await page.route(
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
  await page.getByRole("button", { name: "前往官方沙箱" }).click();
  await expect(page.getByText("合成支付网关，不是真实付款")).toBeVisible();
  expect(method).toBe("POST");
  expect(data).toContain("biz_content=synthetic");
  expect(executed).toEqual([]);
});

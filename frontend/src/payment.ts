import type { Order } from "./types";
export type PaymentMode = "mock" | "sandbox" | "production";
export const paymentLabel: Record<string, string> = {
  mock: "开发模拟",
  sandbox: "官方沙箱",
  production: "正式支付",
};
const gateways: Record<string, string> = {
  sandbox: "openapi-sandbox.dl.alipaydev.com",
  production: "openapi.alipay.com",
};
export function paymentUrl(value: string, mode: string) {
  const url = new URL(value);
  if (
    !gateways[mode] ||
    url.protocol !== "https:" ||
    url.hostname !== gateways[mode] ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.pathname !== "/gateway.do" ||
    url.hash
  )
    throw new Error("支付地址不符合当前环境，已阻止跳转");
  return url.toString();
}
export function orderLabel(o: Order) {
  if (o.status === "EXPIRED") {
    if (o.mode === "mock") return "订单已超时取消，请创建新订单";
    if (o.query_status === "NOT_CREATED") return "订单已超时取消，支付宝尚未创建交易";
    if (o.query_status === "QUERY_FAILED") return "订单已过期，付款状态待确认，可重试查询";
    return "订单已过期，付款入口已关闭，支付宝状态待确认";
  }
  if (o.status === "REFUNDING") return "退款处理中或待确认，剩余权益已暂停";
  if (o.status === "CASH_REFUNDED") return "现金退款已确认，训练包不可继续使用";
  if (o.status === "PAID") return "已确认，权益已发放";
  if (o.status === "CLOSED") return "交易已关闭，未发放权益";
  if (o.status === "REVIEW_REQUIRED")
    return "交易关闭或退款待复核，暂不能使用剩余权益";
  if (o.query_status === "QUERY_FAILED")
    return "查询失败，尚未确认付款，可重试";
  if (o.query_status === "WAIT_BUYER_PAY") return "等待买家付款";
  if (o.query_status === "NOT_CREATED")
    return "支付宝尚未创建交易，请发起支付或稍后查询";
  return "等待支付确认";
}

export function paymentForm(html: string, mode: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const forms = doc.querySelectorAll("form");
  if (
    forms.length !== 1 ||
    forms[0].getAttribute("method")?.toLowerCase() !== "post"
  )
    throw new Error("支付表单不合法，已阻止提交");
  const action = paymentUrl(forms[0].getAttribute("action") || "", mode);
  const fields: [string, string][] = [];
  const seen = new Set<string>();
  for (const input of forms[0].querySelectorAll("input")) {
    if (input.type === "submit") continue;
    if (
      input.type !== "hidden" ||
      !input.name ||
      seen.has(input.name) ||
      input.hasAttribute("formaction")
    )
      throw new Error("支付字段不合法，已阻止提交");
    seen.add(input.name);
    fields.push([input.name, input.value]);
  }
  if (!seen.has("biz_content")) throw new Error("支付表单缺少订单，已阻止提交");
  return { action, fields };
}

export function submitPaymentForm(html: string, mode: string) {
  const parsed = paymentForm(html, mode);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = parsed.action;
  for (const [name, value] of parsed.fields) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  HTMLFormElement.prototype.submit.call(form);
}

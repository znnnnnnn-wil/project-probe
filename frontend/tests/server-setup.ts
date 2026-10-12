import { request } from "@playwright/test";
export default async function setup() {
  const context = await request.newContext();
  try {
    const response = await context.get("https://39.96.27.134/api/config");
    if (!response.ok()) throw new Error("服务器配置检查失败");
    const config = await response.json();
    if (config.modelMode !== "demo" || config.paymentMode !== "mock")
      throw new Error("完整 mock 闭环仅允许在 demo/mock 环境运行，禁止调用真实模型或付款");
  } finally {
    await context.dispose();
  }
}

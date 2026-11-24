import { request } from "@playwright/test";
export default async function setup() {
  const context = await request.newContext();
  try {
    const response = await context.get("https://39.96.27.134/api/config");
    if (!response.ok()) throw new Error("服务器配置检查失败");
    const config = await response.json();
    if (config.modelMode !== "demo")
      throw new Error("服务器回归仅允许在规则演示环境运行");
  } finally {
    await context.dispose();
  }
}

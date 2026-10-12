import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const origin = process.env.DEMO_ORIGIN || "http://localhost:5173";
const url = new URL(origin);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("合成数据脚本仅允许本机地址");
if (!process.env.DEMO_USERNAME || !process.env.DEMO_PASSWORD)
  throw new Error(
    "请在进程环境中设置 DEMO_USERNAME 与 DEMO_PASSWORD（至少10字符）",
  );
let cookie = "";
async function api(path, method = "GET", data) {
  const response = await fetch(origin + "/api" + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  if (!response.ok) throw new Error("请求失败 " + path + " " + response.status);
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return response.json();
}
const config = await api("/config");
if (config.modelMode !== "demo" || config.paymentMode !== "mock")
  throw new Error("仅可在规则演示和开发模拟支付环境加载示例");
await api("/auth/register", "POST", {
  username: process.env.DEMO_USERNAME,
  password: process.env.DEMO_PASSWORD,
});
let project = await api(
  "/projects",
  "POST",
  JSON.parse(
    await readFile(new URL("../demo/project.json", import.meta.url), "utf8"),
  ),
);
project = await api("/projects/" + project.id + "/extract", "POST", {});
await api("/projects/" + project.id + "/confirm", "POST", {
  version: project.version,
  facts: project.facts,
});
const order = await api("/orders", "POST", { requestKey: crypto.randomUUID() });
await api("/orders/" + order.id + "/mock-pay", "POST", {});
console.log(
  "已创建合成项目和一包模拟训练权益。使用所设置的账号登录即可体验；未产生真实交易。",
);

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  (await readFile(path.join(root, ".env"), "utf8"))
    .split(/\r?\n/)
    .filter((v) => /^MODEL_\w+=/.test(v))
    .map((v) => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]),
);
if (
  !process.argv.includes("--free-quota-confirmed") ||
  env.MODEL_FREE_QUOTA_CONFIRMED_MODEL !== env.MODEL_NAME
)
  throw new Error(
    "先在百炼开启当前模型用完即停并确认生效，配置确认模型后才可探测；不自动转付费",
  );
if (
  env.MODEL_BASE_URL !== "https://dashscope.aliyuncs.com/compatible-mode/v1" ||
  env.MODEL_NAME !== "qwen3.8-max-0902"
)
  throw new Error("探测仅允许已配置的百炼免费额度候选 qwen3.8-max-0902");
const started = Date.now();
let report;
try {
  const response = await fetch(env.MODEL_BASE_URL + "/chat/completions", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + env.MODEL_API_KEY,
    },
    body: JSON.stringify({
      model: env.MODEL_NAME,
      enable_thinking: false,
      max_tokens: 64,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: '只返回 JSON 对象 {"ready":true}。' },
        { role: "user", content: "合成连通性检查" },
      ],
    }),
  });
  const value = await response.json();
  report = {
    date: new Date().toISOString(),
    model: env.MODEL_NAME,
    status: response.status,
    elapsedMs: Date.now() - started,
    ...(response.ok
      ? {
          ready: JSON.parse(value.choices[0].message.content).ready === true,
          usage: value.usage,
        }
      : {
          errorCode: /^[A-Za-z0-9_.-]{1,100}$/.test(value.error?.code || "")
            ? value.error.code
            : "provider_error",
        }),
  };
} catch {
  report = {
    date: new Date().toISOString(),
    model: env.MODEL_NAME,
    status: "NETWORK_OR_FORMAT_ERROR",
    elapsedMs: Date.now() - started,
  };
}
await writeFile(
  path.join(root, ".runtime", "bailian-probe.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
if (report.ready !== true) process.exitCode = 1;

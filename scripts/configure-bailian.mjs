// 仅从本地忽略目录读取密钥，不将其放入命令行或输出。
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, ".runtime", "bailian-key");
const key = (await readFile(source, "utf8")).trim();
if (!/^sk-[A-Za-z0-9._-]+$/.test(key)) throw new Error("本地密钥格式无效");
const file = path.join(root, ".env");
let content = await readFile(file, "utf8");
const settings = {
  MODEL_MODE: "demo", // 连通性通过后才启用 live，不将未验证配置当成可用。
  MODEL_PROVIDER: "DashScope",
  MODEL_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  MODEL_NAME: "qwen3.8-max-0902",
  MODEL_TIMEOUT_SECONDS: "40",
  MODEL_FREE_QUOTA_CONFIRMED_MODEL: "",
  MODEL_FREE_QUOTA_ONLY: "true",
  MODEL_API_KEY: key,
};
for (const [name, value] of Object.entries(settings)) {
  const pattern = new RegExp("^" + name + "=.*$", "m");
  content = pattern.test(content)
    ? content.replace(pattern, () => name + "=" + value)
    : content + "\n" + name + "=" + value;
}
await writeFile(file, content, { mode: 0o600 });
await unlink(source);
console.log("百炼服务端配置已保存；密钥不输出，连通性验证前保留 demo。");

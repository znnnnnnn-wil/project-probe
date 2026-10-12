// 独立沙箱：不读取根目录 .env、不使用用户原库、不调用真实模型。
import { readFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await readFile(
  path.join(root, ".secrets/alipay/sandbox/payment.env"),
  "utf8",
);
const config = {};
for (const line of profile.split(/\r?\n/)) {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (
    match &&
    (match[1].startsWith("ALIPAY_SANDBOX_") ||
      [
        "TRAINING_PRICE_CENTS",
        "PAYMENT_RECONCILE_ENABLED",
        "PAYMENT_OPERATIONS_ENABLED",
      ].includes(match[1]))
  )
    config[match[1]] = match[2].trim();
}
const data = path.join(root, ".runtime/payment-sandbox");
await mkdir(data, { recursive: true });
const env = {
  ...process.env,
  ...config,
  PAYMENT_MODE: "sandbox",
  MODEL_MODE: "demo",
  MODEL_API_KEY: "",
  MODEL_NAME: "",
  BIND_ADDRESS: "127.0.0.1",
  PORT: "18084",
  APP_ORIGIN: process.env.SANDBOX_APP_ORIGIN || "http://localhost:5175",
  DB_URL: `jdbc:h2:file:${path.join(data, "database").replaceAll("\\", "/")};MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;WRITE_DELAY=0`,
  DB_USER: "sa",
  DB_PASSWORD: "",
  SECURE_COOKIE: process.env.SANDBOX_SECURE_COOKIE || "false",
  TRUSTED_PROXY_ADDRESSES: "",
};
// 不将其他环境密钥或账号继承到沙箱进程。
for (const key of Object.keys(env))
  if (key.startsWith("ALIPAY_") && !key.startsWith("ALIPAY_SANDBOX_"))
    delete env[key];
const java = process.env.JAVA_HOME
  ? path.join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";
const child = spawn(
  java,
  ["-jar", path.join(root, "backend/target/project-probe-1.0.0.jar")],
  {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);
console.log(
  "独立沙箱后端：18084；演示模型；原始配置和用户数据库不变。前端另开终端按 PAYMENT.md 启动。",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill());
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", () => {
  console.error("沙箱后端启动失败，请先构建 JAR 并检查 JAVA_HOME");
  process.exit(1);
});

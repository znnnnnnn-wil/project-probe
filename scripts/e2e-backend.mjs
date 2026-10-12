import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "18082",
      BIND_ADDRESS: "127.0.0.1",
      APP_ORIGIN: "http://localhost:5174",
      TRUSTED_PROXY_ADDRESSES: "",
      DB_URL:
        "jdbc:h2:mem:browser-regression;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
      DB_USER: "sa",
      DB_PASSWORD: "",
      MODEL_MODE: "demo",
      MODEL_API_KEY: "",
      MODEL_NAME: "",
      PAYMENT_MODE: "mock",
      ALIPAY_PRIVATE_KEY: "",
      ALIPAY_PUBLIC_KEY: "",
      ALIPAY_APP_ID: "",
      ALIPAY_SELLER_ID: "",
      ALIPAY_NOTIFY_URL: "",
      SECURE_COOKIE: "false",
    },
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    child.kill();
  });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", () => {
  console.error("隔离测试后端启动失败，请检查 JAVA_HOME 与后端 JAR");
  process.exit(1);
});

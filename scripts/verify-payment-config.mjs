// 全新内存库启动两种真实环境的缺配置模式；不加载 .env 或本机真实密钥。
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import net from "node:net";
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
for (const mode of ["sandbox", "production"]) {
  const portCheck = net.createServer();
  await new Promise((resolve, reject) => {
    portCheck.once("error", reject);
    portCheck.listen(18085, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => portCheck.close(resolve));
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("ALIPAY_")) delete env[key];
  Object.assign(env, {
    PAYMENT_MODE: mode,
    MODEL_MODE: "demo",
    MODEL_API_KEY: "",
    MODEL_NAME: "",
    PORT: "18085",
    BIND_ADDRESS: "127.0.0.1",
    APP_ORIGIN: "http://localhost:5176",
    TRUSTED_PROXY_ADDRESSES: "",
    SECURE_COOKIE: "false",
    PAYMENT_RECONCILE_ENABLED: "false",
    DB_URL: `jdbc:h2:mem:config-${mode};MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE`,
    DB_USER: "sa",
    DB_PASSWORD: "",
  });
  const logs = [];
  const child = spawn(
    java,
    ["-jar", path.join(root, "backend/target/project-probe-1.0.0.jar")],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (b) => logs.push(b.toString()));
  let cookie = "";
  async function api(p, method = "GET", body) {
    return fetch("http://127.0.0.1:18085/api" + p, {
      method,
      headers: {
        Origin: env.APP_ORIGIN,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error("缺配置测试服务退出");
      try {
        if ((await api("/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert(ready, "隔离测试服务未就绪");
    const response = await api("/auth/register", "POST", {
      username: "config-" + randomUUID(),
      password: "synthetic-password",
    });
    assert(response.ok);
    cookie = response.headers.get("set-cookie").split(";")[0];
    const config = await (await api("/config")).json();
    assert.equal(config.paymentMode, mode);
    assert.equal(config.paymentConfigured, false);
    const shop = await (await api("/shop")).json();
    assert(shop.configurationIssues.length >= 5);
    assert.equal(shop.packages.length, 0);
    const o = await (
      await api("/orders", "POST", { requestKey: randomUUID(), amountCents: 1 })
    ).json();
    assert.equal(o.amount_cents, 990);
    assert.equal((await api(`/orders/${o.id}/checkout`, "POST")).status, 503);
    assert.equal((await api(`/orders/${o.id}/sync`, "POST")).status, 503);
    assert.equal((await api(`/orders/${o.id}/mock-pay`, "POST")).status, 404);
    assert.equal(
      (await (await api(`/orders/${o.id}`)).json()).status,
      "PENDING",
    );
    assert.equal((await (await api("/shop")).json()).packages.length, 0);
    console.log(
      "PASS: " +
        mode +
        " 缺配置真实进程、价格不可篡改、支付/查询拒绝、无模拟降级与权益",
    );
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await writeFile(
      path.join(root, `.runtime/payment-${mode}-missing-config.log`),
      logs.join(""),
    );
  }
}

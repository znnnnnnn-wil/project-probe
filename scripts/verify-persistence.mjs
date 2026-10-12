// 使用独立文件库及本机端口，验证 JVM 重启后记录、会话、权益和报告仍在。
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, ".runtime", "persistence-" + Date.now());
await mkdir(runtime, { recursive: true });
const port = 18081;
const origin = "http://localhost:" + port;
let child;
let cookie = "";
const java = process.env.JAVA_HOME
  ? path.join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";
async function launch() {
  try {
    await fetch(origin + "/api/health");
    throw new Error("测试端口已被占用，拒绝误用旧进程");
  } catch (e) {
    if (!e.cause) throw e;
  }
  child = spawn(
    java,
    ["-jar", path.join(root, "backend/target/project-probe-1.0.0.jar")],
    {
      cwd: runtime,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        PORT: String(port),
        BIND_ADDRESS: "127.0.0.1",
        APP_ORIGIN: origin,
        DB_URL:
          "jdbc:h2:file:./db;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;WRITE_DELAY=0",
        DB_USER: "sa",
        DB_PASSWORD: "",
        MODEL_MODE: "demo",
        PAYMENT_MODE: "mock",
      },
    },
  );
  child.stderr.on("data", () => {});
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("测试后端退出");
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("测试后端启动超时");
}
async function stop() {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill();
    await exited;
    for (let i = 0; i < 30; i++) {
      try {
        await fetch(origin + "/api/health");
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("JVM 未完全停止，重启验证无效");
  }
}
async function api(route, method = "GET", body) {
  const r = await fetch(origin + "/api" + route, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  if (!r.ok) throw new Error(route + ": " + r.status + " " + (await r.text()));
  return await r.json();
}
try {
  await launch();
  await api("/auth/register", "POST", {
    username: "restart-synthetic",
    password: "synthetic-password-only",
  });
  let p = await api("/projects", "POST", {
    name: "重启恢复合成项目",
    responsibility: "我负责预约接口",
    implementation: "数据库唯一约束",
  });
  p = await api("/projects/" + p.id + "/extract", "POST", {});
  p = await api("/projects/" + p.id + "/confirm", "POST", {
    version: p.version,
    facts: p.facts,
  });
  const order = await api("/orders", "POST", { requestKey: "restart-order" });
  await api("/orders/" + order.id + "/mock-pay", "POST", {});
  let t = await api("/trainings", "POST", {
    projectId: p.id,
    requestKey: "restart-training",
  });
  t = await api("/trainings/" + t.id + "/answer", "POST", {
    turnId: t.turns[0].id,
    answer: "唯一约束处理并发，冲突回滚。",
  });
  await stop();
  await launch();
  t = await api("/trainings/" + t.id);
  assert.equal(t.turns[0].answer, "唯一约束处理并发，冲突回滚。");
  assert.equal(t.status, "ACTIVE");
  assert.equal((await api("/shop")).packages.length, 1);
  t = await api("/trainings/" + t.id + "/finish", "POST", {});
  assert.equal(t.status, "COMPLETED");
  await stop();
  await launch();
  const recovered = await api("/trainings/" + t.id);
  assert.equal(
    recovered.report.findings[0].evidence[0].quote,
    "唯一约束处理并发，冲突回滚。",
  );
  console.log(
    "PASS: JVM 两次重启后会话、项目、已提交回答、权益及报告原文均保留。",
  );
} finally {
  await stop();
}

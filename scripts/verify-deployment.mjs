// 独立 Compose 验收：不读取 .env，不连接已有数据库，不调用外部模型/支付。
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import net from "node:net";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(root, ".runtime");
const supplied = process.argv[2];
const runtime = supplied
  ? path.resolve(root, supplied)
  : path.join(runtimeRoot, "deployment-" + Date.now());
assert(
  runtime.startsWith(runtimeRoot + path.sep),
  "只能使用 .runtime 下的隔离目录",
);
await mkdir(runtime, { recursive: true });
const emptyKeyDirectory = path.join(runtime, "alipay-empty");
await mkdir(emptyKeyDirectory, { recursive: true });
let context;
if (supplied) {
  context = JSON.parse(
    await readFile(path.join(runtime, "context.json"), "utf8"),
  );
  assert.equal(context.syntheticOnly, true);
  assert(/^probe-acceptance(?:-\d+)?$/.test(context.project));
} else {
  context = { project: "probe-acceptance-" + Date.now(), syntheticOnly: true };
  await writeFile(path.join(runtime, "context.json"), JSON.stringify(context));
  await writeFile(
    path.join(runtime, "compose.env"),
    [
      "POSTGRES_PASSWORD=" + randomUUID().replaceAll("-", ""),
      "APP_ENV_FILE=" +
        path
          .relative(root, path.join(runtime, "app.env"))
          .replaceAll("\\", "/"),
      "WEB_PORT=18088",
      "PROXY_NETWORK_PREFIX=172.30.189",
    ].join("\n"),
  );
  await writeFile(
    path.join(runtime, "app.env"),
    [
      "APP_ORIGIN=http://localhost:18088",
      "SECURE_COOKIE=false",
      "MODEL_MODE=demo",
      "MODEL_API_KEY=",
      "MODEL_NAME=",
      "PAYMENT_MODE=mock",
      "ALIPAY_PRIVATE_KEY=",
      "ALIPAY_PUBLIC_KEY=",
      "ALIPAY_APP_ID=",
      "ALIPAY_SELLER_ID=",
      "ALIPAY_NOTIFY_URL=",
    ].join("\n"),
  );
  await writeFile(
    path.join(runtime, "ports.yml"),
    'services:\n  db:\n    ports:\n      - "127.0.0.1:15439:5432"\n',
  );
}
const envFile = await readFile(path.join(runtime, "compose.env"), "utf8");
const password = envFile.match(/^POSTGRES_PASSWORD=([a-f0-9]{32})\s*$/m)?.[1];
assert(password, "需要本脚本生成的合成数据库密码");
const configuredEnvFile = envFile.match(/^APP_ENV_FILE=(.+)$/m)?.[1]?.trim();
assert.equal(
  path.resolve(root, configuredEnvFile || ""),
  path.join(runtime, "app.env"),
  "禁止回退读取根目录 .env",
);
const origin = "http://localhost:18088";
const composeArgs = [
  "compose",
  "-p",
  context.project,
  "--env-file",
  path.join(runtime, "compose.env"),
  "-f",
  path.join(root, "compose.yml"),
  "-f",
  path.join(runtime, "ports.yml"),
];
const report = {
  date: new Date().toISOString(),
  project: context.project,
  status: "RUNNING",
  checks: [],
};
async function run(command, args, options = {}) {
  const log = [];
  const child = spawn(command, args, {
    cwd: root,
    windowsHide: true,
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (b) => log.push(b.toString()));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  const output = log.join("");
  if (options.logName)
    await writeFile(
      path.join(runtime, options.logName),
      output.replaceAll(password, "[REDACTED]"),
    );
  if (code !== 0)
    throw new Error(
      command + " 失败；详情见隔离目录日志（退出码 " + code + "）",
    );
  return output;
}
const compose = (args, options) =>
  run("docker", [...composeArgs, ...args], {
    ...options,
    env: {
      ...process.env,
      POSTGRES_PASSWORD: password,
      APP_ENV_FILE: path.join(runtime, "app.env"),
      WEB_PORT: "18088",
      PROXY_NETWORK_PREFIX: "172.30.189",
      ALIPAY_KEY_DIRECTORY: emptyKeyDirectory,
    },
  });
const pass = (name) => {
  report.checks.push(name);
  console.log("PASS: " + name);
};
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      if (
        (
          await fetch(origin + "/api/health", {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("部署后端健康检查超时");
}
let cookie = "";
async function api(route, method = "GET", body) {
  const response = await fetch(origin + "/api" + route, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(100000),
  });
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  assert(response.ok, route + " HTTP " + response.status);
  return response.json();
}
const syntheticEnv = {
  ...process.env,
  SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE: "3",
  SPRING_DATASOURCE_HIKARI_MINIMUM_IDLE: "0",
  TRUSTED_PROXY_ADDRESSES: "",
  MODEL_MODE: "demo",
  MODEL_API_KEY: "",
  PAYMENT_MODE: "mock",
  ALIPAY_PRIVATE_KEY: "",
  ALIPAY_PUBLIC_KEY: "",
  ALIPAY_APP_ID: "",
  ALIPAY_SELLER_ID: "",
  PROBE_TEST_DB_URL: "jdbc:postgresql://127.0.0.1:15439/regression",
  PROBE_TEST_DB_USER: "projectprobe",
  PROBE_TEST_DB_PASSWORD: password,
};
try {
  if (!supplied)
    for (const port of [18088, 15439]) {
      await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", () =>
          reject(new Error("验收端口已占用：" + port)),
        );
        server.listen(port, "127.0.0.1", () => server.close(resolve));
      });
    }
  await compose(["config", "--quiet"]);
  if (!supplied) {
    console.log("构建隔离部署；首次下载可能较慢，完成后继续验收。");
    await compose(["up", "--build", "-d"], { logName: "build.log" });
  }
  await ready();
  assert.deepEqual(
    await api("/config").then((v) => [v.modelMode, v.paymentMode]),
    ["demo", "mock"],
  );
  await compose(["exec", "-T", "web", "nginx", "-t"], { logName: "nginx.log" });
  pass("Compose 配置、镜像启动、Nginx 配置和应用健康检查");
  await compose(
    [
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "projectprobe",
      "-d",
      "projectprobe",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "CREATE DATABASE regression",
    ],
    { logName: "database.log" },
  );
  // Windows .cmd 必须由 cmd 启动；命令文本固定，不拼接环境值。
  const backendOutput = await run(
    process.platform === "win32" ? "cmd.exe" : "mvn",
    process.platform === "win32"
      ? ["/d", "/c", "mvn.cmd -B test"]
      : ["-B", "test"],
    {
      cwd: path.join(root, "backend"),
      env: syntheticEnv,
      logName: "postgres-tests.log",
    },
  );
  const summaries = [
    ...backendOutput.matchAll(
      /Tests run: (\d+), Failures: 0, Errors: 0, Skipped: (\d+)/g,
    ),
  ];
  const totalTests = Number(summaries.at(-1)?.[1]);
  assert(totalTests >= 99 && backendOutput.includes("BUILD SUCCESS"));
  const skippedTests = Number(summaries.at(-1)?.[2] || 0);
  pass(`${totalTests - skippedTests} 项后端测试通过、${skippedTests} 项跳过，独立 PostgreSQL regression 库`);
  const browserOutput = await run(
    process.platform === "win32" ? "cmd.exe" : "npm",
    process.platform === "win32"
      ? [
          "/d",
          "/c",
          "npx.cmd playwright test --config playwright.deployment.config.ts",
        ]
      : [
          "exec",
          "playwright",
          "test",
          "--",
          "--config",
          "playwright.deployment.config.ts",
        ],
    {
      cwd: path.join(root, "frontend"),
      env: { ...syntheticEnv, PROBE_E2E_ORIGIN: origin },
      logName: "browser-tests.log",
    },
  );
  const browserCount = Number(browserOutput.match(/(\d+) passed/)?.[1]);
  assert(browserCount >= 11, "应执行原有闭环和新增支付浏览器回归");
  pass(
    browserCount + " 项浏览器测试通过 Nginx 部署；支付真实环境为合成响应夹具",
  );
  await api("/auth/register", "POST", {
    username: "restart-" + randomUUID(),
    password: "synthetic-password-only",
  });
  let p = await api("/projects", "POST", {
    name: "部署恢复合成项目",
    responsibility: "我负责预约接口",
    implementation: "唯一约束保护并发写入",
  });
  p = await api("/projects/" + p.id + "/extract", "POST", {});
  p = await api("/projects/" + p.id + "/confirm", "POST", {
    version: p.version,
    facts: p.facts,
  });
  const order = await api("/orders", "POST", { requestKey: randomUUID() });
  const paid = await Promise.all(
    Array.from({ length: 8 }, () =>
      api("/orders/" + order.id + "/mock-pay", "POST", {}),
    ),
  );
  assert(paid.every((o) => o.status === "PAID"));
  assert.equal((await api("/shop")).packages.length, 1);
  let t = await api("/trainings", "POST", {
    projectId: p.id,
    requestKey: randomUUID(),
  });
  t = await api("/trainings/" + t.id + "/answer", "POST", {
    turnId: t.turns[0].id,
    answer: "合成回答：冲突写入回滚并返回冲突结果。",
  });
  await compose(["restart", "backend"], { logName: "restart-backend.log" });
  await ready();
  t = await api("/trainings/" + t.id);
  assert.equal(t.status, "ACTIVE");
  assert.equal(t.turns[0].answer, "合成回答：冲突写入回滚并返回冲突结果。");
  t = await api("/trainings/" + t.id + "/finish", "POST", {});
  await compose(["restart", "db", "backend"], {
    logName: "restart-database.log",
  });
  await ready();
  const recovered = await api("/trainings/" + t.id);
  assert.equal(
    recovered.report.findings[0].evidence[0].quote,
    t.turns[0].answer,
  );
  assert.equal((await api("/shop")).packages.length, 1);
  pass(
    "8 次并发模拟支付只发一包；后端和 PostgreSQL 重启后会话、回答、权益、报告恢复",
  );
  // 将专用验收库备份还原到新库，绝不覆盖运行库。
  const sql = (database, query) => compose(["exec", "-T", "db", "psql", "-U", "projectprobe", "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", query]);
  const tables = ["app_users", "projects", "project_revisions", "purchase_orders", "training_packages", "trainings", "entitlement_events", "answer_drafts", "account_recovery", "project_trials", "model_usage", "report_views", "user_feedback"];
  const beforeRestore = {};
  for (const table of tables) beforeRestore[table] = (await sql("projectprobe", `SELECT COUNT(*) FROM ${table}`)).trim();
  await compose(["exec", "-T", "db", "pg_dump", "-U", "projectprobe", "-Fc", "-f", "/tmp/probe-acceptance.dump", "projectprobe"], { logName: "backup.log" });
  await sql("projectprobe", "CREATE DATABASE restore_check");
  await compose(["exec", "-T", "db", "pg_restore", "-U", "projectprobe", "-d", "restore_check", "--exit-on-error", "/tmp/probe-acceptance.dump"], { logName: "restore.log" });
  for (const table of tables) assert.equal((await sql("restore_check", `SELECT COUNT(*) FROM ${table}`)).trim(), beforeRestore[table], table + "还原数量不一致");
  const evidenceSql = "SELECT md5(body) FROM trainings ORDER BY id";
  assert.equal(await sql("restore_check", evidenceSql), await sql("projectprobe", evidenceSql), "训练与报告原文还原不一致");
  pass("独立数据库备份还原至restore_check：13张业务表数量和训练报告原文摘要一致，未覆盖运行库");
  // 两个 Docker 网络客户端保有不同 TCP 来源；不以伪造转发头模拟两个访客。
  const python = `import urllib.request, urllib.error, json, os
def request(target, path='/api/auth/login', spoof=''):
    headers={'Origin':'${origin}', 'Content-Type':'application/json', 'X-Forwarded-For':spoof, 'Forwarded':'for='+spoof, 'X-Real-IP':spoof, 'X-Probe-Client-IP':spoof}
    req=urllib.request.Request(target+path,data=json.dumps({'username':'nonexistent-synthetic','password':'synthetic-password'}).encode(),headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=10) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
mode=os.environ['CHECK_MODE']
if mode=='limited':
    for i in range(20): assert request('http://web',spoof='203.0.113.'+str(i+1))==401
    assert request('http://web',spoof='198.51.100.42')==429
    assert request('http://web','/api/auth/logout')==200
elif mode=='independent': assert request('http://web',spoof='198.51.100.42')==401
else:
    for i in range(20): assert request('http://backend:8080',spoof='203.0.113.'+str(i+1))==401
    assert request('http://backend:8080',spoof='198.51.100.42')==429
print('PASS: '+mode)
`;
  for (const [index, mode] of ["limited", "independent", "direct"].entries()) {
    await run(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        context.project + "_app_proxy",
        "--ip",
        "172.30.189." + (21 + index),
        "-e",
        "CHECK_MODE=" + mode,
        "python:3.11-slim",
        "python",
        "-c",
        python,
      ],
      { logName: "proxy-" + mode + ".log" },
    );
  }
  pass(
    "真实 Nginx 两客户端额度独立；同客户端超限、伪造头无效、退出可用、直连头不能绕过",
  );
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error.message;
  throw error;
} finally {
  await writeFile(
    path.join(runtime, "result.json"),
    JSON.stringify(report, null, 2),
  );
  // 保留隔离卷和日志供审查，不删除数据卷，也不操作其他项目。
  await compose(["down"], { logName: "shutdown.log" });
  console.log(
    "验收记录：" + path.relative(root, path.join(runtime, "result.json")),
  );
}

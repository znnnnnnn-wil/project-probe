// 真实模型验收仅在运营者确认百炼用完即停生效后运行；不执行控制台计费设置。
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
if (!process.argv.includes("--free-quota-confirmed"))
  throw new Error(
    "先确认百炼当前模型的免费额度用完即停已生效，再传入 --free-quota-confirmed",
  );
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const caseName = process.argv.find((v) => v.startsWith("--case="))?.slice(7);
assert(
  !caseName ||
    ["responsibility", "verification", "exceptions"].includes(caseName),
  "只允许内置合成质量案例",
);
const qualityCase = caseName
  ? JSON.parse(
      await readFile(
        path.join(root, "demo/quality", caseName + ".json"),
        "utf8",
      ),
    )
  : null;
const runtime = path.join(root, ".runtime", "live-model-" + Date.now());
await mkdir(runtime, { recursive: true });
const resumeArg = process.argv.find((v) => v.startsWith("--resume="));
const resumePath = resumeArg
  ? path.resolve(root, resumeArg.slice("--resume=".length))
  : null;
assert(
  !resumePath ||
    resumePath.startsWith(path.join(root, ".runtime", "live-model-")),
  "只能恢复本脚本的合成模型验收库",
);
const previous = resumePath
  ? JSON.parse(await readFile(path.join(resumePath, "result.json"), "utf8"))
  : null;
assert(!previous?.caseName || previous.caseName === (caseName || "reservation"), "恢复时必须使用原案例，不能混用合成回答");
assert(
  !previous ||
    (previous.provider === "DashScope" &&
      previous.username?.startsWith("live-synthetic-")),
  "恢复记录须为合成百炼验收",
);
const env = Object.fromEntries(
  (await readFile(path.join(root, ".env"), "utf8"))
    .split(/\r?\n/)
    .filter((v) => /^MODEL_\w+=/.test(v))
    .map((v) => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]),
);
assert(
  env.MODEL_API_KEY &&
    env.MODEL_BASE_URL ===
      "https://dashscope.aliyuncs.com/compatible-mode/v1" &&
    env.MODEL_NAME === "qwen3.8-max-0902",
  "仅验收已配置的百炼 qwen3.8-max-0902，不自动切换模型或付费端点",
);
assert.equal(
  env.MODEL_FREE_QUOTA_CONFIRMED_MODEL,
  env.MODEL_NAME,
  "当前模型的用完即停尚未确认，不发起模型请求",
);
const port = 18083,
  origin = "http://localhost:" + port;
await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", () => reject(new Error("真实模型隔离测试端口已占用")));
  server.listen(port, "127.0.0.1", () => server.close(resolve));
});
const java = process.env.JAVA_HOME
  ? path.join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";
const child = spawn(
  java,
  [
    "-Dfile.encoding=UTF-8",
    "-jar",
    path.join(root, "backend/target/project-probe-1.0.0.jar"),
  ],
  {
    cwd: runtime,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
      MODEL_MODE: "live",
      PORT: String(port),
      BIND_ADDRESS: "127.0.0.1",
      APP_ORIGIN: origin,
      TRUSTED_PROXY_ADDRESSES: "",
      SECURE_COOKIE: "false",
      DB_URL:
        "jdbc:h2:file:" +
        (resumePath
          ? path.join(resumePath, "db").replaceAll("\\", "/")
          : "./db") +
        ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;WRITE_DELAY=0",
      DB_USER: "sa",
      DB_PASSWORD: "",
      PAYMENT_MODE: "mock",
      ALIPAY_PRIVATE_KEY: "",
      ALIPAY_PUBLIC_KEY: "",
      ALIPAY_APP_ID: "",
      ALIPAY_SELLER_ID: "",
      ALIPAY_NOTIFY_URL: "",
    },
  },
);
const usage = [];
const failures = [];
let lineBuffer = "",
  cookie = "",
  deep,
  retest;
const report = {
  date: new Date().toISOString(),
  provider: env.MODEL_PROVIDER,
  model: env.MODEL_NAME,
  caseName: caseName || "reservation",
  status: "RUNNING",
  checks: [],
  usage,
  failures,
};
child.stdout.on("data", (b) => {
  lineBuffer += b.toString();
  const lines = lineBuffer.split(/\r?\n/);
  lineBuffer = lines.pop();
  for (const line of lines) {
    const m = line.match(
      /model_call .*promptTokens=(\d+) completionTokens=(\d+) elapsedMs=(\d+)/,
    );
    if (m)
      usage.push({
        promptTokens: +m[1],
        completionTokens: +m[2],
        elapsedMs: +m[3],
      });
    if (
      line.includes("model_call_failed") ||
      line.includes("training_generation_failed")
    )
      failures.push(line.slice(line.indexOf(" : ") + 3));
  }
});
child.stderr.on("data", () => {}); // 不输出服务端完整日志或材料。
const pass = (name) => {
  report.checks.push(name);
  console.log("PASS: " + name);
};
async function api(route, method = "GET", body) {
  const response = await fetch(origin + "/api" + route, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(95000),
  });
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  assert(
    response.ok,
    route + " HTTP " + response.status + "（回答保存在隔离库，可恢复）",
  );
  return response.json();
}
function verifyEvidence(t) {
  assert.equal(t.status, "COMPLETED");
  assert(
    Array.isArray(t.report.clearParts) &&
      Array.isArray(t.report.findings) &&
      Array.isArray(t.report.retestTopics),
  );
  for (const finding of t.report.findings)
    for (const evidence of finding.evidence) {
      assert.equal(
        evidence.quote,
        t.turns.find((v) => v.id === evidence.turnId)?.answer,
      );
    }
}
try {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("隔离模型测试后端退出");
    try {
      if ((await fetch(origin + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal((await api("/config")).modelMode, "live");
  let project;
  if (previous) {
    report.username = previous.username;
    report.resumedFrom = path.relative(root, resumePath);
    await api("/auth/login", "POST", {
      username: previous.username,
      password: "synthetic-live-test-password",
    });
    deep = await api("/trainings/" + previous.deep.id);
    assert(["FAILED", "COMPLETED"].includes(deep.status));
    assert.equal(deep.turns.filter((t) => t.answer).length, 2);
    project = await api("/projects/" + deep.project.id);
    if (deep.status === "FAILED") {
      deep = await api("/trainings/" + deep.id + "/retry", "POST", {});
      pass("真实失败训练保留两段回答，重试恢复原训练且未创建新权益");
      if (deep.status === "ACTIVE") {
        deep = await api("/trainings/" + deep.id + "/finish", "POST", {});
        pass("追问故障恢复后，使用已保留回答生成报告");
      }
    } else {
      pass("已恢复的真实报告持久保存，继续后续验证且不重复调用复盘模型");
    }
  } else {
    report.username = "live-synthetic-" + randomUUID();
    await api("/auth/register", "POST", {
      username: report.username,
      password: "synthetic-live-test-password",
    });
    project = await api(
      "/projects",
      "POST",
      qualityCase?.project ||
        JSON.parse(
          await readFile(path.join(root, "demo/project.json"), "utf8"),
        ),
    );
    project = await api("/projects/" + project.id + "/extract", "POST", {});
    assert(
      project.facts.some((f) =>
        ["AI_INFERENCE", "NEEDS_CONFIRMATION"].includes(f.source),
      ),
    );
    project = await api("/projects/" + project.id + "/confirm", "POST", {
      version: project.version,
      facts: project.facts,
    });
    pass("真实模型事实提取通过类型、来源与原文引用校验");
    const order = await api("/orders", "POST", { requestKey: randomUUID() });
    await api("/orders/" + order.id + "/mock-pay", "POST", {});
    deep = await api("/trainings", "POST", {
      projectId: project.id,
      requestKey: randomUUID(),
    });
    for (const answer of qualityCase?.answers || [
      "这是合成预约项目。我负责预约创建接口、预约表唯一约束和部分集成测试。前端由同学实现。请求进入 Controller，Service 在事务内检查参数并插入预约，数据库限制同座位同时间段的有效预约唯一。我还没有实现跨时间段重叠处理，也没有完整验证取消与创建同时发生的行为。",
      "我会让数据库约束兜底，而不是仅依赖查询后插入。唯一冲突时回滚并返回冲突提示。目前没有请求幂等键，没有处理数据库已提交但响应丢失后的客户端重试。我只验证了两个相同时间段的并发预约只有一次成功，对超时重试、取消并发和不同时间段重叠仍缺少测试。",
    ]) {
      const current = deep.turns.at(-1);
      deep = await api("/trainings/" + deep.id + "/answer", "POST", {
        turnId: current.id,
        answer,
      });
      assert(deep.turns.at(-1).question && deep.turns.at(-1).topic);
    }
    assert.notEqual(deep.turns[1].question, deep.turns[2].question);
    pass("根据真实项目回答连续生成两次追问，问题与主题标签均保存");
    deep = await api("/trainings/" + deep.id + "/finish", "POST", {});
  }
  verifyEvidence(deep);
  assert(
    deep.report.findings.length > 0,
    "合成回答刻意提供了待补充项，需人工检查模型没有发现的原因",
  );
  pass("真实模型生成复盘，证据逐条对应原回答，报告提供补充任务");
  const refreshed = await api("/trainings/" + deep.id);
  assert.equal(
    refreshed.report.findings[0].evidence[0].quote,
    deep.report.findings[0].evidence[0].quote,
  );
  if (
    refreshed.retestEntry?.trainingId &&
    ["CONTINUE", "COMPLETED"].includes(refreshed.retestEntry.state)
  ) {
    retest = await api("/trainings/" + refreshed.retestEntry.trainingId);
    if (retest.status === "FAILED") {
      retest = await api("/trainings/" + retest.id + "/retry", "POST", {});
      pass("已有失败复测保留原回答，直接重试恢复报告且不重复扣次");
    } else if (
      retest.status === "ACTIVE" &&
      retest.turns.some((t) => t.answer)
    ) {
      retest = await api("/trainings/" + retest.id + "/finish", "POST", {});
    }
  } else {
    project = await api("/projects/" + project.id, "PUT", {
      ...project,
      implementation:
        project.implementation.split("\n修订说明：")[0] +
        "\n修订说明：" +
        (qualityCase?.revision.implementation ||
          "计划新增客户端请求号和用户联合唯一约束，成功结果随事务记录；重试先查询原结果。尚未实际实现，不能声称已完成。"),
      verification:
        project.verification.split("\n修订验证计划：")[0] +
        "\n修订验证计划：" +
        (qualityCase?.revision.verification ||
          "覆盖提交成功但响应丢失、重复请求号、同号不同参数、取消与创建并发。当前仅是设计，不代表测试已通过。"),
    });
    project = await api("/projects/" + project.id + "/extract", "POST", {});
    project = await api("/projects/" + project.id + "/confirm", "POST", {
      version: project.version,
      facts: project.facts,
    });
    retest = await api("/trainings", "POST", {
      projectId: project.id,
      parentId: deep.id,
      requestKey: randomUUID(),
    });
    assert.equal(retest.status, "ACTIVE");
    assert.equal(retest.turns[0].topic, retest.focus);
    assert.equal(retest.parentId, deep.id);
    assert(retest.project.implementation.includes("修订说明"));
    assert(!deep.turns.some((t) => t.question === retest.turns[0].question));
    const before = usage.length;
    const duplicate = await api("/trainings", "POST", {
      projectId: project.id,
      parentId: deep.id,
      requestKey: randomUUID(),
    });
    assert.equal(duplicate.id, retest.id);
    assert.equal(usage.length, before);
    pass(
      "真实复测首题关联上轮薄弱点和修订材料，重复开始不创建训练或再次调用模型",
    );
    retest = await api("/trainings/" + retest.id + "/answer", "POST", {
      turnId: retest.turns[0].id,
      answer:
        qualityCase?.retestAnswer ||
        "修订仍是计划。我会在事务里同时保存请求号、用户和处理结果，联合唯一约束阻止重复执行。同号不同参数应拒绝；响应丢失后按请求号查询已保存结果。我还需要用故障注入验证提交后断连，并验证取消并发。跨时间段重叠处理尚未实现，我不能把这些方案说成已验证成果。",
    });
    retest = await api("/trainings/" + retest.id + "/finish", "POST", {});
  }
  verifyEvidence(retest);
  assert.equal(
    (await api("/trainings/" + deep.id)).retestEntry.state,
    "COMPLETED",
  );
  pass("复测报告和前后原文保存，入口切换为查看结果");
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error.message;
  throw error;
} finally {
  report.deep = deep;
  report.retest = retest;
  report.totalTokens = usage.reduce(
    (n, u) => n + u.promptTokens + u.completionTokens,
    0,
  );
  await writeFile(
    path.join(runtime, "result.json"),
    JSON.stringify(report, null, 2),
  );
  if (child.exitCode === null) {
    const exit = new Promise((r) => child.once("exit", r));
    child.kill();
    await exit;
  }
  console.log(
    "真实模型调用记录：" +
      path.relative(root, path.join(runtime, "result.json")) +
      "；已记录 " +
      usage.length +
      " 次成功请求，合计 " +
      report.totalTokens +
      " tokens（以百炼账单为准）",
  );
}

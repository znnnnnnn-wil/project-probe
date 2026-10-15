import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "https://39.96.27.134:18443";
const output = path.join(root, ".runtime/server-reset-recovery");
await mkdir(output, { recursive: true });
const assert = (value, message) => { if (!value) throw new Error(message); };
const hash = value => createHash("sha256").update(value).digest("hex");
const historyKey = hash("synthetic-recovered-project");
const projectId = randomUUID();
const question1 = "请说明合成预约项目中你负责的接口与请求链路。";
const question2 = "针对上一轮尚未验证的重试边界，请说明准备怎样验证。";
const answer1 = "第一轮：我负责预约接口，重试边界尚未验证。";
const answer2 = "第二轮：我补充了重复提交测试方案，但尚无实际测试结果。";
const project = { id: projectId, name: "多轮合成预约项目", background: "合成验收材料", targetRole: "后端", stack: "Java", responsibility: "接口实现", resume: "合成预约项目：我负责接口实现。", architecture: "", implementation: "", problems: "", verification: "", materials: "", facts: [], factsConfirmed: true, version: 1 };
const records = [2, 1].map(round => ({ id: randomUUID(), kind: "DEEP", status: "ACTIVE", maxTurns: 5, leaseUntil: 0, createdAt: Date.now() - (3 - round) * 60000, modelMode: "live", historyKey, historyRoundNumber: round, project, turns: [{ id: randomUUID(), topic: round === 1 ? "项目介绍" : "验证边界", question: round === 1 ? question1 : question2, answer: round === 1 ? answer1 : answer2, answeredAt: Date.now() - (3 - round) * 50000 }] }));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const configResponse = await context.request.get(base + "/api/config");
      assert(configResponse.ok(), "公网后端不可达");
      const config = await configResponse.json();
      assert(config.modelMode === "live" && config.paymentMode === "sandbox" && config.speechEnabled && config.resumeImportEnabled, "线上配置未恢复");
      const entry = await context.request.get(base + "/");
      assert(entry.ok() && hash(await entry.body()) === hash(await readFile(path.join(root, "frontend/dist/index.html"))), "公网入口哈希不匹配");
      assert(entry.headers()["content-security-policy"].includes("wasm-unsafe-eval") && entry.headers()["permissions-policy"].includes("microphone=(self)"), "语音/VAD安全策略不完整");
      for (const [file, type] of [["ort-wasm-simd-threaded.wasm", "application/wasm"], ["ort-wasm-simd-threaded.mjs", "text/javascript"], ["silero_vad_v5.onnx", "application/octet-stream"]]) {
        const response = await context.request.get(base + "/vad/0.0.31-ort1.22/" + file, { headers: { Range: "bytes=0-15" } });
        assert(response.status() === 206 && response.headers()["content-type"].includes(type) && (await response.body()).length === 16, "VAD资源未正确发布：" + file);
      }
      const registration = await context.request.post(base + "/api/auth/register", { headers: { Origin: base }, data: { username: "reset-synthetic-" + randomUUID(), password: randomUUID() + randomUUID() } });
      assert(registration.ok(), "新合成账号注册失败");
      const shop = await (await context.request.get(base + "/api/shop")).json();
      const ten = shop.products.find(item => item.code === "TEN_TRAININGS");
      const lifetime = shop.products.find(item => item.code === "LIFETIME");
      assert(ten.amountCents === 990 && ten.trainingLimit === 10 && lifetime.amountCents === 999900 && lifetime.lifetime, "套餐定价不匹配");
      assert(!shop.operationsEnabled && !shop.orders.length && !shop.packages.length, "合成账号不应存在已付权益或开放现金操作");
      const page = await context.newPage();
      const errors = [];
      let businessWrites = 0;
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (!["GET", "HEAD"].includes(request.method()) && /\/api\/(orders|payments|trainings|projects|resume)/.test(request.url())) businessWrites++; });
      // Synthetic view fixtures only: no purchased training or AI call is fabricated.
      await page.route("**/api/trainings", route => route.fulfill({ json: records }));
      for (const record of records) await page.route("**/api/trainings/" + record.id, route => route.fulfill({ json: record }));
      await page.goto(base + "/#/history");
      await page.locator(".history-record").first().waitFor();
      assert(await page.locator(".history-record").count() === 2, "历史记录未显示");
      await page.getByLabel("筛选训练项目").selectOption(historyKey);
      for (const detail of await page.locator(".history-record summary").all()) await detail.click();
      for (const text of [question1, question2, answer1, answer2]) assert(await page.getByText(text, { exact: true }).isVisible(), "完整问答不可见");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "历史页横向溢出");
      await page.screenshot({ path: path.join(output, `history-public-${width}.png`), fullPage: true });
      await page.reload();
      await page.locator(".history-record summary").first().click();
      assert(await page.getByText(answer2, { exact: true }).isVisible(), "历史问答刷新后未恢复");
      await page.goto(base + "/#/trainings/" + records[0].id);
      await page.getByLabel("你的回答", { exact: true }).waitFor();
      assert(await page.getByRole("button", { name: "开始录音", exact: true }).isVisible(), "语音入口未恢复");
      await page.goto(base + "/#/projects/new");
      await page.getByRole("button", { name: "导入简历", exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "简历页横向溢出");
      await page.screenshot({ path: path.join(output, `resume-public-${width}.png`), fullPage: true });
      assert(businessWrites === 0 && errors.length === 0, "意外业务写入或页面脚本错误");
      await context.request.post(base + "/api/auth/logout", { headers: { Origin: base } });
      checks.push({ width, tlsVerified: true, scriptErrors: errors.length, businessWrites, syntheticHistoryViewVerified: true, voiceEntryVerified: true, resumeEntryVerified: true, vadAssetsVerified: true, catalogVerified: true });
    } finally { await context.close(); }
  }
  const result = { status: "PASSED", origin: base, checks, realUserMaterialReads: 0, paymentOrTrainingWrites: 0, liveProviderCalls: 0, historyViewUsesSyntheticFixtures: true };
  await writeFile(path.join(output, "public-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }

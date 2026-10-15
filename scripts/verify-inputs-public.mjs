import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const emptyProject = { name: "", background: "", targetRole: "", stack: "", responsibility: "", resume: "", architecture: "", implementation: "", problems: "", verification: "", materials: "", facts: [], factsConfirmed: false };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".runtime/resume-extraction-acceptance");
await mkdir(output, { recursive: true });
const base = "https://39.96.27.134";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
const page = await context.newPage();
const errors = [];
let paymentWrites = 0;
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (request.method() !== "GET" && /\/api\/(orders|payments)/.test(request.url())) paymentWrites++; });
const assert = (value, message) => { if (!value) throw new Error(message); };
const wait = async (locator, text) => {
  await locator.waitFor({ state: "visible", timeout: 70000 });
  if (text) assert((await locator.textContent()).includes(text), "页面状态与预期不一致");
};
const source = await readFile(path.join(root, "backend/target/test-fixtures/synthetic-resume.txt"), "utf8");
const docx = await readFile(path.join(root, "backend/target/test-fixtures/synthetic-resume.docx"));
try {
  const registration = await context.request.post(base + "/api/auth/register", { headers: { Origin: base }, data: { username: "public-inputs-" + crypto.randomUUID(), password: crypto.randomUUID() + crypto.randomUUID() } });
  assert(registration.ok(), "合成账号注册失败");
  const config = await (await context.request.get(base + "/api/config")).json();
  assert(config.speechEnabled && config.resumeImportEnabled && config.modelMode === "live", "线上识别配置未启用");
  const entry = await context.request.get(base + "/");
  assert(entry.headers()["content-security-policy"].includes("media-src 'self' blob:"), "未允许本地录音试听");
  const speechProof = JSON.parse(await readFile(path.join(root, ".runtime/input-acceptance/speech-provider.json"), "utf8"));
  assert(speechProof.status === "PASSED", "真实语音模型验收未通过");
  await page.goto(base + "/#/projects/new");
  await wait(page.getByRole("button", { name: "导入简历", exact: true }));
  assert(!(await page.locator(".mode-strip").textContent()).includes("真实 AI"), "顶部仍显示真实AI");
  await page.getByRole("checkbox", { name: "同意将简历文字发送至模型服务，并在本账号缓存识别结果30天" }).check();
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/api/resume/import") && response.request().method() === "POST", { timeout: 80000 });
  await page.getByLabel("上传简历文件").setInputFiles({ name: "synthetic-resume.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx });
  const response = await responsePromise;
  const parsed = await response.json();
  assert(response.ok(), "公网简历识别失败：" + (parsed.message || response.status()));
  assert(parsed.projects?.length === 2, "未识别出两个合成项目");
  assert(parsed.duplicate === false, "新账号首次导入不应命中缓存");
  const selected = parsed.projects.find(project => project.name.includes("Synthetic Memory"));
  assert(selected && selected.responsibility.includes("有限重试"), "合成项目名称或职责识别不正确");
  assert(!selected.resume.includes("Synthetic Tool Router"), "不同项目原文发生混用");
  for (const project of parsed.projects) for (const value of Object.values(project)) assert(typeof value === "string" && (!value || value.split("\n").every(line => source.includes(line))), "识别结果未来自原文");
  // Reload and rename to verify a persistent server cache, not browser state.
  await wait(page.locator(".resume-candidate").first());
  await page.reload();
  await page.getByRole("checkbox", { name: "同意将简历文字发送至模型服务，并在本账号缓存识别结果30天" }).check();
  const duplicatePromise = page.waitForResponse(response => response.url().endsWith("/api/resume/import") && response.request().method() === "POST");
  await page.getByLabel("上传简历文件").setInputFiles({ name: "renamed-resume.txt", mimeType: "text/plain", buffer: Buffer.from("\uFEFF" + source.replaceAll("\n", "\r\n")) });
  const duplicateResponse = await duplicatePromise;
  const duplicate = await duplicateResponse.json();
  assert(duplicateResponse.ok() && duplicate.duplicate === true, "改名重复上传未复用缓存");
  assert(JSON.stringify(duplicate.projects) === JSON.stringify(parsed.projects) && duplicate.recognizedAt === parsed.recognizedAt, "缓存结果或首次识别时间不一致");
  await wait(page.getByText(/这份简历已上传过/));
  await wait(page.locator(".resume-candidate").first());
  await page.locator(".resume-candidate").filter({ hasText: selected.name }).getByRole("button", { name: "使用这个项目" }).click();
  assert(await page.getByLabel("项目名称", { exact: true }).inputValue() === selected.name, "项目未自动填入");
  assert(await page.getByLabel("个人职责（必填）", { exact: true }).inputValue() === selected.responsibility, "职责未自动填入");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "简历页面横向溢出");
    await page.screenshot({ path: path.join(output, `resume-public-${width}.png`), fullPage: true });
  }
  // Only the interview view uses synthetic API fixtures; no training or order is created.
  const trainingId = crypto.randomUUID(), turnId = crypto.randomUUID();
  const fixture = { id: trainingId, status: "ACTIVE", kind: "DEEP", maxTurns: 5, leaseUntil: 0, createdAt: Date.now(), modelMode: "live", project: { ...emptyProject, ...selected, id: crypto.randomUUID(), version: 1, facts: [], factsConfirmed: true }, turns: [{ id: turnId, question: "请介绍这个合成项目，以及你负责的部分。", topic: "项目介绍", answer: "" }] };
  await page.route("**/api/trainings/" + trainingId, route => route.fulfill({ json: fixture }));
  await page.route("**/api/trainings/" + trainingId + "/transcribe", route => route.fulfill({ json: { text: "我负责预约接口，验证结果尚待补充。" } }));
  await page.goto(base + "/#/trainings/" + trainingId);
  await wait(page.getByLabel("你的回答", { exact: true }));
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await wait(page.getByRole("button", { name: "结束录音", exact: true }));
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "结束录音", exact: true }).click();
  await wait(page.getByText("语音已填入回答", { exact: true }));
  assert(await page.getByLabel("你的回答", { exact: true }).inputValue() === "我负责预约接口，验证结果尚待补充。", "转写未自动加入回答");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "语音页面横向溢出");
    await page.screenshot({ path: path.join(output, `voice-public-${width}.png`), fullPage: true });
  }
  assert(paymentWrites === 0 && errors.length === 0, "公网页面有脚本错误或交易写入");
  await context.request.post(base + "/api/auth/logout", { headers: { Origin: base } });
  const result = { status: "PASSED", liveDocxTwoProjectExtractionVerified: true, originalLineEvidenceVerified: true, persistentResumeDedupVerified: true, docxToTxtDedupVerified: true, liveSpeechProviderVerifiedPreviously: true, speechUiUsesSyntheticFixtures: true, tlsVerified: true, microphoneAndAutomaticAppendVerified: true, paymentWrites, scriptErrors: errors.length, userMaterialReads: 0, projectSaves: 0, widths: [1440, 390] };
  await writeFile(path.join(output, "public-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await context.close(); await browser.close(); }

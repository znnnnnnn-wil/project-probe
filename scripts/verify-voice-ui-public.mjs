import { chromium } from "../frontend/node_modules/playwright-core/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectSpeechPCM } from "./vad-test-audio.mjs";
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.runtime/vad-acceptance");
await mkdir(output, { recursive: true });
const base = "https://39.96.27.134";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const assert = (ok, message) => { if (!ok) throw new Error(message); };
let transcriptions = 0, answerWrites = 0;
const errors = [];
const assets = new Set();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["microphone"] });
    try {
      const registration = await context.request.post(base + "/api/auth/register", { headers: { Origin: base }, data: { username: "voice-ui-" + crypto.randomUUID(), password: crypto.randomUUID() + crypto.randomUUID() } });
      assert(registration.ok(), "合成账号注册失败");
      const config = await (await context.request.get(base + "/api/config")).json();
      assert(config.speechEnabled, "线上语音未启用");
      const id = crypto.randomUUID(), turnId = crypto.randomUUID();
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => {
        if (response.ok() && response.url().includes("/vad/")) assets.add(new URL(response.url()).pathname.split("/").pop());
      });
      page.on("request", request => {
        if (request.method() !== "GET" && /\/api\/(orders|payments)|\/(answer|finish)$/.test(request.url())) answerWrites++;
      });
      await page.route("**/api/trainings/" + id, route => route.fulfill({ json: {
        id, status: "ACTIVE", kind: "DEEP", maxTurns: 5, createdAt: Date.now(), modelMode: "live",
        project: { id: crypto.randomUUID(), name: "合成语音验收项目", responsibility: "我负责接口", facts: [] },
        turns: [{ id: turnId, question: "请介绍你负责的部分。", topic: "项目职责", answer: "" }]
      } }));
      await page.route("**/api/trainings/" + id + "/transcribe", async route => {
        transcriptions++;
        const body = route.request().postDataBuffer();
        const offset = body.indexOf(Buffer.from("RIFF"));
        assert(offset >= 0 && body.readUInt32LE(offset + 24) === 16000, "未生成16kHz WAV");
        await route.fulfill({ json: { text: "我负责接口和并发验证。" } });
      });
      await page.goto(base + "/#/trainings/" + id);
      await injectSpeechPCM(page);
      const answer = page.getByLabel("你的回答", { exact: true });
      await answer.fill("已有草稿");
      assert(await page.getByRole("checkbox", { name: /同意.*录音/ }).count() === 0, "仍要求勾选同意");
      await page.getByRole("button", { name: "开始录音", exact: true }).click();
      await page.getByRole("button", { name: "结束录音", exact: true }).waitFor();
      assert(await page.getByRole("button", { name: "提交并继续", exact: true }).isDisabled(), "录音中仍可提交");
      await page.getByText("语音已填入回答", { exact: true }).waitFor({ timeout: 25000 });
      assert(await answer.inputValue() === "已有草稿\n我负责接口和并发验证。", "未自动追加到最新草稿");
      assert(await page.getByLabel("语音转写结果").count() === 0, "正常转写仍需点击加入");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "页面横向溢出");
      await page.screenshot({ path: path.join(output, `voice-auto-${width}.png`), fullPage: true });
      await page.reload();
      await answer.waitFor();
      assert(await answer.inputValue() === "已有草稿\n我负责接口和并发验证。", "草稿未持久保留");
      await context.request.post(base + "/api/auth/logout", { headers: { Origin: base } });
    } finally { await context.close(); }
  }
  assert(transcriptions === 2 && answerWrites === 0 && errors.length === 0, "出现重复转写、提交或脚本错误");
  assert(assets.has("silero_vad_v5.onnx") && assets.has("ort-wasm-simd-threaded.wasm") && assets.has("ort-wasm-simd-threaded.mjs"), "VAD模型或WASM未由本站正确加载");
  const result = { status: "PASSED", widths: [1440, 390], realSileroBrowserInferenceVerified: true, selfHostedAssets: [...assets], singleClickAndSilenceAutoFillVerified: true, noConsentCheckbox: true, draftPersistenceVerified: true, syntheticAudioAndTranscription: true, paidAsrCalls: 0, answerWrites, transcriptions, scriptErrors: errors.length };
  await writeFile(path.join(output, "public-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }

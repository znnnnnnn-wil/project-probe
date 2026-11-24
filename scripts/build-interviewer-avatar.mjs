import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdk = path.resolve(process.env.HUMANFORGE_ROOT || path.join(project, ".runtime/humanforge"));
const output = path.resolve(process.argv[2] || path.join(project, "frontend/public/models/interviewer-v2.glb"));
const manifest = JSON.parse(await fs.readFile(path.join(sdk, "package.json"), "utf8"));
if (manifest.version !== "0.5.0") throw new Error("Expected HumanForge v0.5.0; see docs/interviewer-avatar-build.md");
const revision = "b3e5885ade1b3d48e12994a121e33e07e806390b";
const { stdout: sdkHead } = await promisify(execFile)("git", ["-C", sdk, "rev-parse", "HEAD"]);
if (sdkHead.trim() !== revision) throw new Error(`Expected HumanForge revision ${revision}`);
const bundle = await build({
  entryPoints: [path.join(project, "scripts/interviewer-avatar.entry.ts")],
  bundle: true, format: "esm", platform: "browser", write: false,
  alias: { "humanforge-runtime": path.join(sdk, "src/human/runtime.ts") },
  nodePaths: [path.join(project, "frontend/node_modules")],
});
const assets = path.join(sdk, "assets/human");
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/export.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
    } else if (pathname.startsWith("/forge-assets/")) {
      const file = path.resolve(assets, decodeURIComponent(pathname.slice(14)));
      if (!file.startsWith(assets + path.sep)) throw new Error("Invalid asset path");
      const extension = path.extname(file);
      res.setHeader("Content-Type", extension === ".json" ? "application/json" : extension === ".webp" ? "image/webp" : "application/octet-stream");
      res.end(await fs.readFile(file));
    } else if (pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><script type="module" src="/export.js"></script>');
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error));
  }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(5281, "127.0.0.1", resolve); });
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5281/");
  await page.waitForFunction(() => typeof window.exportInterviewerV2 === "function");
  const base64 = await page.evaluate(() => window.exportInterviewerV2());
  const scratch = path.join(project, ".runtime", `${path.basename(output)}.raw.glb`);
  await fs.mkdir(path.dirname(scratch), { recursive: true });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(scratch, Buffer.from(base64, "base64"));
  const result = await promisify(execFile)(process.execPath, [path.join(project, "scripts/sparsify-avatar-glb.mjs"), scratch, output]);
  console.log(result.stdout.trim());
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

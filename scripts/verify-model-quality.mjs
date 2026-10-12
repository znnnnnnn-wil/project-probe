// 运行内置合成案例；自动断言业务/证据结构，语义质量需另行人工复核。
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv.includes("--free-quota-confirmed"))
  throw new Error("须确认当前模型用完即停，脚本不会自动切换模型");
const runtime = path.join(root, ".runtime", "model-quality-" + Date.now());
await mkdir(runtime, { recursive: true });
const results = {
  date: new Date().toISOString(),
  status: "RUNNING",
  semanticReview: "PENDING",
  cases: [],
};
try {
  for (const name of ["responsibility", "verification", "exceptions"]) {
    console.log("CASE: " + name);
    let output = "";
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(root, "scripts/verify-live-model.mjs"),
          "--free-quota-confirmed",
          "--case=" + name,
        ],
        { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (b) => {
        output += b.toString();
        process.stdout.write(b);
      });
      child.stderr.on("data", () => {});
      child.on("error", reject);
      child.on("exit", resolve);
    });
    const stamp = output.match(/live-model-(\d+)[\\/]result\.json/);
    const artifact = stamp
      ? path.join(".runtime", "live-model-" + stamp[1], "result.json")
      : null;
    const run = artifact
      ? JSON.parse(await readFile(path.join(root, artifact), "utf8"))
      : null;
    results.cases.push({
      name,
      artifact,
      status: run?.status || "FAILED",
      checks: run?.checks || [],
      totalTokens: run?.totalTokens || 0,
      failures: run?.failures || [],
      error: run?.error || (code ? "验收子进程失败" : undefined),
    });
    await writeFile(
      path.join(runtime, "result.json"),
      JSON.stringify(results, null, 2),
    );
    if (code || run?.status !== "PASSED")
      throw new Error("案例 " + name + " 未通过，停止后续调用；已保留隔离记录");
  }
  results.status = "STRUCTURAL_CHECKS_PASSED";
} catch (error) {
  results.status = "FAILED";
  results.error = error.message;
  process.exitCode = 1;
} finally {
  results.totalTokens = results.cases.reduce(
    (sum, item) => sum + item.totalTokens,
    0,
  );
  await writeFile(
    path.join(runtime, "result.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    "多项目记录：" +
      path.relative(root, path.join(runtime, "result.json")) +
      "；" +
      results.status +
      "；语义质量仍须人工复核",
  );
}

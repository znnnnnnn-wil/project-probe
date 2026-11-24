import { test, expect } from "@playwright/test";
import { trainingFixture } from "./training-fixture";

for (const [status, label] of [
  ["MODEL_REVIEWED_NEEDS_HUMAN_REVIEW", "已做第二次AI语义复核；技术结论仍需人工核对。"],
  ["SOURCE_SPANS_CHECKED_NEEDS_REVIEW", "已逐字核对所引原文片段；判断是否成立仍需人工复核。"],
]) for (const width of [1440, 390]) {
  test(`报告展示原文片段及人工核对边界 ${status} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { training, post } = await trainingFixture(page);
    await post(`/trainings/${training.id}/answer`, { turnId: training.turns[0].id, answer: "我只测了正常预约，尚未执行并发测试。" });
    const completed = await post(`/trainings/${training.id}/finish`);
    completed.report.mode = "live";
    completed.report.qualityReview = { version: "semantic-v1", status: "MODEL_REVIEWED", model: "synthetic", humanVerified: false };
    if (status === "SOURCE_SPANS_CHECKED_NEEDS_REVIEW") delete completed.report.qualityReview;
    const finding = completed.report.findings[0];
    finding.evidenceStatus = status;
    finding.supportingQuotes = [{ sourceId: "T1", quote: "尚未执行并发测试" }];
    await page.route(`**/api/trainings/${training.id}`, route => route.fulfill({ json: completed }));
    await page.goto(`/#/report/${training.id}`);
    const card = page.locator("article.finding").first();
    await expect(card.getByText(label)).toBeVisible();
    await card.getByText("本条判断对应的原文片段").click();
    await expect(card.getByText("尚未执行并发测试", { exact: true })).toBeVisible();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 Markdown 报告" }).click();
    const stream = await (await downloadEvent).createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const markdown = Buffer.concat(chunks).toString("utf8");
    expect(markdown).toContain(label);
    expect(markdown).toContain("本条判断对应的原文片段：");
    expect(markdown).toContain("尚未执行并发测试");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBeFalsy();
  });
}

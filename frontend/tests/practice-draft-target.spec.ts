import { expect, test } from "@playwright/test";

const projectId = "draft-target-project";
const path = `/api/projects/${projectId}/practice`;
const draft = "用于回答原追问的语音草稿";
const turn = { id: "shared-turn", topic: "实现", question: "介绍你的实现。", answer: "" };

for (const sameRound of [true, false]) {
  test(sameRound ? "同题推进后旧草稿保持可见但不能错发" : "上一轮草稿不能用于新一轮", async ({ page }) => {
    const active = { status: "ACTIVE", roundId: "current-round", maxTurns: 5, turns: [turn] };
    let state = active;
    const sent: unknown[] = [];
    await page.addInitScript(({ projectId, draft, sameRound, turnId }) => {
      if (sessionStorage.getItem("auth:owner")) return;
      sessionStorage.setItem("auth:owner", "draft-owner");
      sessionStorage.setItem("practice-draft:" + projectId, draft);
      sessionStorage.setItem("practice-draft-turn:" + projectId, turnId);
      sessionStorage.setItem("practice-draft-exchange:" + projectId, "0");
      // A draft from before round metadata was introduced can still be retried.
      if (!sameRound) sessionStorage.setItem("practice-draft-round:" + projectId, "previous-round");
    }, { projectId, draft, sameRound, turnId: turn.id });
    await page.route("**/api/**", route => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname;
      if (endpoint === path) {
        if (request.method() === "POST") {
          sent.push(request.postDataJSON());
          state = { ...state, turns: [{ ...turn, exchanges: [
            { answer: "另一标签页的回答", reply: "你怎样验证这一点？" },
          ] }] };
          return route.fulfill({ status: 409, json: { message: "对话进度已更新" } });
        }
        return route.fulfill({ json: state });
      }
      const response: Record<string, unknown> = {
        "/api/config": { modelMode: "demo", speechEnabled: true },
        "/api/me": { id: "draft-owner", username: "草稿回归" },
        [`/api/projects/${projectId}`]: { id: projectId, name: "草稿回归项目" },
      };
      return route.fulfill({ json: response[endpoint] ?? {} });
    });
    await page.goto(`/#/projects/${projectId}?interview=1`);
    const retry = page.getByRole("button", { name: "重试发送" });
    if (sameRound) {
      await retry.click();
      await expect(page.getByRole("region", { name: "本题对话" })).toContainText("你怎样验证这一点？");
    }
    const stale = page.getByRole("region", { name: "旧追问的回答草稿" });
    await expect(stale).toContainText(draft);
    await expect(retry).toHaveCount(0);
    page.once("dialog", dialog => dialog.accept());
    await page.reload();
    await expect(stale).toContainText(draft);
    await expect(retry).toHaveCount(0);
    await stale.getByRole("button", { name: "放弃这段回答" }).click();
    await expect(stale).toHaveCount(0);
    await expect(page.getByRole("button", { name: "同意并进入语音面试" })).toBeEnabled();
    expect(sent).toEqual(sameRound ? [
      { answer: draft, turnId: turn.id, dialogue: true, exchangeCount: 0 },
    ] : []);
  });
}

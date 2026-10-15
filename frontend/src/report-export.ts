import type { Training } from "./types";

export function reportMarkdown(training: Training) {
  const report = training.report!;
  const lines = [
    "# 项目追问官 · " + training.project.name,
    "",
    `${training.kind === "RETEST" ? "专项复测" : "项目深挖"} · ${new Date(training.createdAt).toLocaleString("zh-CN")}`,
    `反馈来源：${report.mode === "demo" ? "规则演示，不代表 AI 技术评估" : "AI 模型"}`,
    "",
    "## 表达中清晰的部分",
    ...report.clearParts.map((text) => "- " + text),
    "",
    "## 补充任务",
  ];
  report.findings.forEach((finding, index) => {
    const plan = training.reportPlan?.find((task) => task.taskIndex === index);
    lines.push(
      "",
      `### ${index + 1}. ${finding.topic}`,
      "",
      finding.assessment,
      "",
      "补充任务：" + finding.task,
      "",
      "自报进度：" + (plan?.done ? "已补充（未独立验证）" : "待补充"),
    );
    if (plan?.note) lines.push("", "我的补充笔记：", plan.note);
    finding.evidence.forEach((e) =>
      lines.push("", "追问：" + e.question, "", "原回答：", e.quote),
    );
    finding.materials.forEach((fact) =>
      lines.push("", "材料依据：" + fact.text),
    );
  });
  for (const item of report.comparisons || []) {
    lines.push("", "## 复测前后对照 · " + item.topic, "", item.assessment,
      "仅比较已表达内容，未独立验证代码实现。", "", "上轮原回答：");
    item.previousEvidence.forEach(e => lines.push(e.question, e.quote));
    lines.push("", "本轮原回答：");
    item.currentEvidence.forEach(e => lines.push(e.question, e.quote));
  }
  lines.push("", "## 问答记录");
  training.turns
    .filter((turn) => turn.answer)
    .forEach((turn, index) =>
      lines.push("", `### 问题 ${index + 1}`, turn.question, "", turn.answer),
    );
  lines.push(
    "",
    "## 复测主题",
    ...report.retestTopics.map((topic) => "- " + topic),
    "",
    "练习反馈仅供参考，不承诺面试或录用结果。材料、回答与笔记可能包含个人信息，请谨慎分享。",
    "",
  );
  return lines.join("\n");
}

export function downloadReport(training: Training) {
  const url = URL.createObjectURL(
    new Blob([reportMarkdown(training)], {
      type: "text/markdown;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${training.project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 60) || "项目"}-复盘报告.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

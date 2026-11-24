import { useRef, useState, type ReactNode } from "react";
import { Check, Download } from "lucide-react";
import { api } from "./api";
import { EvidenceReview } from "./evidence-review";
import { PracticeRetest } from "./practice-retest";
import { PracticeReview } from "./practice-review";
import { exampleApi } from "./practice-paths";
import type { Report, ScoreDimension } from "./types";
import { Button, Loading, type Actions } from "./ui";
import { useProjectPractice } from "./use-project-practice";
import type { Practice } from "./use-project-practice";
import "./project-practice.css";
import "./practice-archive.css";

const scoreLabels: Record<ScoreDimension["key"], string> = {
  clarity: "表达清晰度",
  ownership: "个人职责",
  depth: "技术深度",
  validation: "验证与边界",
};

function hasPracticeScore(report?: Report) {
  return scoredDimensionCount(report) > 0;
}

function scoredDimensionCount(report?: Report) {
  return report?.scoring?.dimensions.filter(dimension => typeof dimension.score === "number").length ?? 0;
}

function PracticeExport({ practice }: { practice: Practice }) {
  const { report, retest, turns = [] } = practice;
  if (!report) return null;

  const downloadReport = () => {
    const scoring = report.scoring;
    const original = turns.find(turn => turn.id === retest?.turnId);
    const comparison = retest?.report?.comparisons?.[0];
    const content = [
      "# 项目追问官 · 项目练习复盘",
      practice.modelMode === "live" ? "AI 练习复盘" : "规则演示",
      "## 本场评分",
      ...(scoring ? [
        scoring.total == null ? "暂无有效评分" : `综合分 ${scoring.total} / 100 · ${scoredDimensionCount(report)} / ${scoring.dimensions.length} 项已评分`,
        ...scoring.dimensions.map(dimension =>
          `- ${scoreLabels[dimension.key]} · ${dimension.score == null ? "未覆盖" : `${dimension.score} / 25`} · ${dimension.reason}`),
      ] : ["未评分"]),
      "## 清晰的部分", ...report.clearParts.map(text => "- " + text),
      ...report.findings.flatMap((finding, index) => [
        `## 补充方向 ${index + 1} · ${finding.topic}`, finding.assessment, "建议任务：" + finding.task,
        ...finding.evidence.map(entry => "原回答：" + entry.quote),
        ...finding.materials.map(material => "材料依据：" + material.text),
      ]),
      "## 完整问答", ...turns.flatMap((turn, index) => [
        `### ${index + 1}. ${turn.question}`,
        ...(turn.exchanges?.length
          ? turn.exchanges.flatMap(({ answer, reply }) => [`你 · ${answer}`, `面试官 · ${reply}`])
          : [turn.answer]),
      ]),
      ...(retest?.status === "COMPLETED" && original
        ? ["## 专项复测", original.question, "初答：" + original.answer, "补答：" + retest.answer,
          comparison?.assessment || "请结合两次原回答核对新增细节与待验证事项。"]
        : []),
      "回答属于用户自述，技术结论仍需结合代码与测试核对。",
    ].join("\n\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "项目追问官-项目训练复盘.md";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <Button secondary onClick={downloadReport}><Download size={15} aria-hidden="true" />导出本轮复盘</Button>;
}

function PracticeResult({ practice, scoreAction }: { practice: Practice; scoreAction?: ReactNode }) {
  const conversation = useRef<HTMLOListElement>(null);
  const turns = practice.turns ?? [];
  const report = practice.report;
  const scoring = report?.scoring;
  const scored = scoredDimensionCount(report);
  const hasScore = scored > 0;
  const evidenceLinks = (turnIds: string[]) => {
    const indices = turns.flatMap((turn, index) => turnIds.includes(turn.id) ? [index] : []);
    if (!indices.length) return null;
    return (
      <div className="practice-evidence-links">
        {indices.map(index => <button type="button" key={index} onClick={() => {
          const target = conversation.current?.children.item(index);
          if (!(target instanceof HTMLElement)) return;
          const details = target.querySelector("details");
          if (details) details.open = true;
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: "start" });
        }}>查看第 {index + 1} 题对话</button>)}
      </div>
    );
  };

  const transcript = turns.length > 0 ? (
    <ol className="practice-transcript" ref={conversation}>
      {turns.map((turn, index) => {
        const exchanges = turn.exchanges ?? [];
        const pending = practice.pendingExchange?.turnId === turn.id ? practice.pendingExchange : undefined;
        return (
          <li key={turn.id} tabIndex={-1} aria-label={`第 ${index + 1} 题对话`}>
            <details>
              <summary>第 {index + 1} 题{turn.topic && ` · ${turn.topic}`}</summary>
              <div className="practice-transcript-content">
                <div className="practice-transcript-message"><strong>面试官</strong><p>{turn.question}</p></div>
                {exchanges.map(({ answer, reply }, exchangeIndex) => (
                  <div className="practice-transcript-exchange" key={exchangeIndex}>
                    <div className="practice-transcript-message is-answer"><strong>你</strong><p>{answer}</p></div>
                    {reply && <div className="practice-transcript-message"><strong>面试官</strong><p>{reply}</p></div>}
                  </div>
                ))}
                {!exchanges.length && turn.answer &&
                  <div className="practice-transcript-message is-answer"><strong>你</strong><p>{turn.answer}</p></div>}
                {pending && <div className="practice-transcript-message is-answer"><strong>你</strong><p>{pending.answer}</p></div>}
                {!exchanges.length && !turn.answer && !pending && <p className="practice-transcript-empty">尚未提交回答</p>}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  ) : <p>该场训练还没有生成题目。</p>;

  return (
    <div className="practice-result">
      {report && <>
        <section className="practice-result-block" aria-label="本场评分">
          <div className="practice-score-heading" aria-live="polite">
            <h3>本场评分</h3>
            {scoring?.total != null ? (
              <>
                <strong className="practice-score-total"><small>综合分 </small>{scoring.total}<small> / 100</small></strong>
                <span>{scored} / {scoring.dimensions.length} 项已评分</span>
              </>
            ) : (
              <span>{practice.modelMode === "demo" ? "规则演示 · 未评分" : scoring ? "暂无有效评分" : "未评分"}</span>
            )}
          </div>
          {scoring && <ul className="practice-score-grid">
            {scoring.dimensions.map(dimension => (
              <li key={dimension.key}>
                <div><strong>{scoreLabels[dimension.key]}</strong>
                  <span>{dimension.score == null ? (hasScore ? "未覆盖" : "待评分") : `${dimension.score} / 25`}</span>
                </div>
                <p>{dimension.reason}</p>
                {evidenceLinks(dimension.turnIds)}
              </li>
            ))}
          </ul>}
          {hasScore && <p className="practice-score-note">AI 根据本场回答评分。{scored < (scoring?.dimensions.length ?? 0) && "综合分仅按已评分维度折算。"}</p>}
          {scoreAction}
        </section>
        {report.clearParts.length > 0 && <section className="practice-result-block" aria-label="讲得好的地方">
          <h3>讲得好的地方</h3>
          <ul className="practice-strengths">{report.clearParts.map((text, index) => (
            <li key={index}><Check size={15} aria-hidden="true" />{text}</li>
          ))}</ul>
        </section>}
        {report.findings.length > 0 && <section className="practice-result-block" aria-label="优先改进">
          <h3>优先改进</h3>
          <div className="practice-findings">{report.findings.map((finding, index) => (
            <article key={index}>
              <h4>{finding.topic}</h4>
              <p>{finding.assessment}</p>
              {finding.supportExplanation && <p>{finding.supportExplanation}</p>}
              <p className="practice-task"><strong>下次怎么练</strong>{finding.task}</p>
              <EvidenceReview finding={finding} />
              {finding.evidence.length > 0 && (
                <details><summary>查看回答依据</summary>{finding.evidence.map((entry, quoteIndex) => (
                  <blockquote key={`${entry.turnId}-${quoteIndex}`}>{entry.quote}</blockquote>
                ))}</details>
              )}
              {evidenceLinks(finding.turnIds?.length ? finding.turnIds : finding.evidence.map(entry => entry.turnId))}
            </article>
          ))}</div>
        </section>}
      </>}
      <section className="practice-result-block" aria-label="完整对话">
        <h3>完整对话</h3>
        {transcript}
      </section>
    </div>
  );
}

export function PracticeArchive({ projectId, roundId, example = false, run, busy, onScored }: Actions & {
  projectId: string;
  roundId: string;
  example?: boolean;
  onScored?: () => void;
}) {
  const { endpoint, value: data, error, loadError, load, acceptRetest } = useProjectPractice(projectId, roundId, example);
  const [scorePending, setScorePending] = useState(false);
  const [scoreError, setScoreError] = useState("");
  const loading = data.status === "LOADING";
  const readError = loadError && <div role="alert">
    <p>{error}</p>
    <Button secondary onClick={() => void load()}>重试读取</Button>
  </div>;
  if (loading) return readError || <Loading />;
  const allAnswered = (data.turns?.filter(turn => turn.answer).length ?? 0) >= (data.maxTurns || 1);
  const canScore = data.status === "COMPLETED" && data.modelMode === "live" && data.report?.mode === "live" && !hasPracticeScore(data.report) &&
    data.turns?.some(turn => turn.answer.trim());
  const scoreDisabled = scorePending || busy || loadError || data.retest?.status === "GENERATING";

  async function generateScore() {
    if (!canScore || scoreDisabled) return;
    setScoreError("");
    setScorePending(true);
    try {
      const updated = await api<Practice>(endpoint + "/score", "POST", { roundId });
      if (updated?.roundId !== roundId || !hasPracticeScore(updated.report)) throw new Error("评分未生成，请重试。");
      acceptRetest(updated);
      onScored?.();
    } catch (cause) {
      setScoreError(cause instanceof Error ? cause.message : "评分未生成，请重试。");
    } finally {
      setScorePending(false);
    }
  }

  return (
    <section className="panel practice-archive" aria-label="面试详情">
      {readError}
      {data.report && <div className="action-row"><PracticeExport practice={data} /></div>}
      {!data.report && (
        <p role="status" className="practice-archive-status">
          {allAnswered && data.status === "GENERATING" ? "正在生成本场报告。" :
            allAnswered && data.status === "FAILED" ? "对话已保存，报告等待重试。" :
            data.status === "COMPLETED" ? "这场面试没有可查看的报告。" :
            "面试结束后会生成报告。"}
        </p>
      )}
      <PracticeResult practice={data} scoreAction={canScore && (
        <div className="practice-score-backfill">
          <p>AI 将使用本场已保存的回答生成评分。</p>
          <Button secondary disabled={scoreDisabled} onClick={() => void generateScore()}>
            {scorePending ? "正在生成评分…" : scoreError ? "重试生成评分" : "补生成评分"}
          </Button>
          {scoreError && <p role="alert">{scoreError}</p>}
        </div>
      )} />
      {data.report && <>
        <PracticeRetest endpoint={endpoint} roundId={roundId} report={data.report} retest={data.retest}
          disabled={busy || loadError || scorePending} onChange={acceptRetest} reload={load} />
        <PracticeReview projectId={projectId} endpoint={(example ? exampleApi : "") + "/feedback"} run={run} busy={busy} />
      </>}
    </section>
  );
}

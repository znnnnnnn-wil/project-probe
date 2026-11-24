import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "./api";
import { Button } from "./ui";
import type { Finding, Report } from "./types";
import type { Practice, Retest } from "./use-project-practice";
import "./practice-retest.css";

type Target = { index: number; finding: Finding; evidence: Finding["evidence"][number] };

export function PracticeRetest({
  endpoint, roundId, report, retest, disabled, onChange, reload,
}: {
  endpoint: string;
  roundId?: string;
  report: Report;
  retest?: Retest;
  disabled: boolean;
  onChange: (value: Practice) => void;
  reload: () => Promise<void>;
}) {
  const id = useId();
  const targets: Target[] = report.findings.flatMap((finding, index) =>
    finding.evidence.map(evidence => ({ index, finding, evidence })),
  );
  const [selected, setSelected] = useState(0);
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const target = retest
    ? targets.find(({ index, evidence }) => index === retest.findingIndex && evidence.turnId === retest.turnId)
    : targets[selected];
  if (!target) return null;
  const comparison = retest?.report?.comparisons?.[0];
  const generating = retest?.status === "GENERATING";

  async function submit(current: Target) {
    setPending(true);
    setError("");
    try {
      onChange(await api<Practice>(endpoint + "/retest", "POST", {
        findingIndex: current.index,
        turnId: current.evidence.turnId,
        answer: retest?.answer ?? answer,
        roundId,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "复测失败，请重试");
      await reload();
    } finally {
      setPending(false);
    }
  }

  const responseForm = retest?.status !== "COMPLETED" && (
    <form className="practice-retest-form" onSubmit={event => {
      event.preventDefault();
      if (!disabled && !pending && !generating && (retest?.answer ?? answer).trim()) void submit(target);
    }}>
      {!retest && (
        <label>
          <span>补答</span>
          <textarea
            rows={5}
            maxLength={3000}
            placeholder="可以补充具体做法、处理边界，或你会怎样验证。"
            disabled={disabled || pending}
            value={answer}
            onChange={event => setAnswer(event.target.value)}
            required
          />
        </label>
      )}
      <div className="practice-retest-actions">
        <Button type="submit" disabled={disabled || pending || generating || !(retest?.answer ?? answer).trim()}>
          {pending || generating ? "正在生成对照" : retest ? "重试生成对照" : "提交补答并对照"}
          {!pending && !generating && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
        {generating && <Button secondary disabled={pending} onClick={() => void reload()}>刷新复测状态</Button>}
      </div>
    </form>
  );

  return (
    <section className="practice-retest" aria-labelledby={`${id}-heading`}>
      <div className="practice-retest-header">
        <h3 id={`${id}-heading`}>专项复测</h3>
        {!retest && <p>参考改进建议，重新回答一道题。</p>}
      </div>
      {!retest && targets.length > 1 && (
        <fieldset className="practice-retest-options" disabled={disabled || pending}>
          <legend>选择复测反馈</legend>
          <div className="practice-retest-choice-grid">
            {targets.map(({ index, finding, evidence }, position) => (
              <label className="practice-retest-choice" key={`${index}:${evidence.turnId}`}>
                <input type="radio" name={`${id}-choice`} checked={position === selected} onChange={() => {
                  setSelected(position);
                  setAnswer("");
                  setError("");
                }} />
                <span className="practice-retest-choice-marker" aria-hidden="true" />
                <span className="practice-retest-choice-body">
                  <strong>{finding.topic}</strong>
                  <span className="practice-retest-choice-question">{evidence.question}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <section className="practice-retest-prompt">
        <p className="practice-retest-topic">{target.finding.topic}</p>
        <h4>{target.evidence.question}</h4>
        <p className="practice-retest-task"><strong>补答重点</strong> <span>{target.finding.task}</span></p>
      </section>
      <div className="practice-retest-response">
        <article className="practice-retest-answer">
          <h4>初答</h4>
          <p>{target.evidence.quote}</p>
        </article>
        {retest ? (
          <article className="practice-retest-answer is-revised">
            <h4>补答</h4>
            <p>{retest.answer}</p>
          </article>
        ) : responseForm}
      </div>
      {retest?.status === "COMPLETED" ? (
        <div className="practice-retest-comparison">
          <h4>前后对照</h4>
          <p>{comparison?.assessment || "已保留两次原回答，可以自行核对新增细节与待验证事项。"}</p>
          <small>这里比较回答中的说明，实际实现与测试结果仍需核对。</small>
        </div>
      ) : retest && responseForm}
      {error && <p className="practice-retest-error" role="alert">{error}</p>}
    </section>
  );
}

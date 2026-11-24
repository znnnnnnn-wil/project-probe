import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText } from "lucide-react";
import { demoProject } from "./api";
import { bookingFollowup, bookingQuestion, bookingReview, exampleAnswers } from "./booking-followup";

export function QuickExperience() {
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [stage, setStage] = useState<"first" | "followup" | "review">("first");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [stage]);
  const followup = bookingFollowup(before);
  const result = bookingReview(before, after);

  return (
    <section className="experience-page" aria-labelledby="quick-title">
      <div className="experience-top">
        <a href="#/">返回首页</a>
        <a href="#/experience">完整五轮练习</a>
        <span>本地规则体验 · 回答不上传</span>
      </div>
      <div className="experience-heading">
        <div>
          <h1 id="quick-title">校园预约系统 · 两题体验</h1>
          <p>约 90 秒。可以用自己的话作答，也可以代入一段示例。</p>
        </div>
      </div>
      <div className="experience-workspace">
        <aside className="experience-source">
          <div className="probe-eyebrow"><FileText size={15} /> 合成项目材料</div>
          <div className="experience-source-focus">
            <span>关键实现</span>
            <blockquote>{demoProject.implementation}</blockquote>
            <span>验证记录</span>
            <blockquote>{demoProject.verification}</blockquote>
          </div>
        </aside>
        <div className="experience-conversation">
          {stage === "review" ? (
            <section aria-labelledby="quick-review-title">
              <h2 id="quick-review-title" tabIndex={-1} ref={heading}>两次回答对照</h2>
              <div className="experience-evidence-pair">
                <div><span className="probe-label">初答</span><p>{before}</p></div>
                <div><span className="probe-label">补答</span><p>{after}</p></div>
              </div>
              <h3>规则识别到的补充</h3>
              {result.added.length > 0 ? (
                <ul>{result.added.map(detail => (
                  <li key={detail.label}><strong>{detail.label}</strong> · “{detail.quote}”</li>
                ))}</ul>
              ) : <p>暂未定位到新增的实现或验证细节，可以展开描述再检查。</p>}
              {result.pending.length > 0 && <p>建议继续补充{result.pending.join("、")}。</p>}
              <p>这些是回答中出现的细节，实际实现和测试结果仍需核对。</p>
              <div className="action-row">
                <button className="button secondary" onClick={() => setStage("followup")}>修改补答</button>
                <button className="button" onClick={() => { setBefore(""); setAfter(""); setStage("first"); }}>试试另一种回答</button>
              </div>
            </section>
          ) : (
            <>
              <h2 tabIndex={-1} ref={heading} key={stage}>
                {stage === "first" ? bookingQuestion : followup.question}
              </h2>
              {stage === "first" ? (
                <div className="action-row" aria-label="示例回答">
                  <button className="button secondary" onClick={() => setBefore(exampleAnswers[0])}>示例：只讲约束</button>
                  <button className="button secondary" onClick={() => setBefore(exampleAnswers[1])}>示例：讲清冲突响应</button>
                </div>
              ) : (
                <div className="experience-task">
                  <strong>为什么问这一题</strong>
                  <p>{followup.reason}</p>
                  {followup.quote && <blockquote>“{followup.quote}”</blockquote>}
                </div>
              )}
              <form onSubmit={event => {
                event.preventDefault();
                if (stage === "first" && before.trim()) setStage("followup");
                if (stage === "followup" && after.trim()) setStage("review");
              }}>
                <label>
                  {stage === "first" ? "初答" : "补答"}
                  <textarea
                    key={stage}
                    value={stage === "first" ? before : after}
                    onChange={event => (stage === "first" ? setBefore : setAfter)(event.target.value)}
                    rows={4}
                    maxLength={1500}
                    required
                  />
                </label>
                <div className="experience-submit">
                  {stage === "followup" && (
                    <button className="probe-text-button" type="button" onClick={() => { setAfter(""); setStage("first"); }}>返回修改初答</button>
                  )}
                  <button className="button" disabled={!(stage === "first" ? before : after).trim()}>
                    {stage === "first" ? "看下一问" : "看回答对照"} <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

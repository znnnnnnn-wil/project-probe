import React, { useState } from "react";
import { Button } from "./ui";
import type { Actions } from "./ui";
import { useProjectPractice } from "./use-project-practice";
import { ArrowRight, Check, ChevronDown, ChevronUp, MessageSquare, Sparkles } from "lucide-react";
import "./project-practice.css";
import { PracticeNext } from "./practice-next";
import type { Project } from "./types";

export function ProjectPractice({ projectId, disabled, onSaved, onReview, run, busy }: Actions & {
  projectId: string; disabled: boolean; onSaved: (project: Project) => void; onReview: () => void;
}) {
  const { value, answer, edit, error, loadError, pending, notice, submitted, load, submit } = useProjectPractice(projectId);
  const [expanded, setExpanded] = useState(true);
  const turn = value.turns?.[0];
  const waiting = pending || ["LOADING", "GENERATING"].includes(value.status);
  const action = <Button disabled={busy || (!loadError && (disabled || waiting || (value.status === "ACTIVE" && !answer.trim())))} onClick={() => {
    setExpanded(true); if (loadError) void load(); else void run(submit);
  }}>
    {loadError ? "重新读取体验状态" : value.status === "LOADING" ? "正在读取…" : pending || value.status === "GENERATING" ? "正在生成，自动恢复进度…" : value.status === "ACTIVE" ? "提交体验回答" : value.status === "AVAILABLE" ? "开始一题体验" : "重试或恢复体验"}<ArrowRight size={16} />
  </Button>;
  return <section className="practice-card" aria-label="我的项目一题体验">
    <div className="practice-header">
      <span className="practice-icon"><Sparkles size={22} strokeWidth={1.6} /></span>
      <div className="practice-heading"><h2>先用自己的项目体验一题</h2>
        <p>每账号一次，无需购买训练包；使用已保存的材料。</p></div>
      {!turn && value.status !== "USED" ? action : <span className="practice-badge">{value.report ? "体验已完成" : value.status === "USED" ? "已体验" : "一问一答"}</span>}
      {turn && <button className="practice-toggle" aria-expanded={expanded} aria-controls="practice-content" onClick={() => setExpanded(!expanded)}>
        {expanded ? "收起体验" : "展开体验"}{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>}
    </div>
    <div id="practice-content" hidden={!expanded}>
    {value.status === "USED" ? <p className="practice-footnote">本账号已体验，可核对项目事实后使用训练包继续练习。</p> : <>
      {turn && <div className={"practice-body" + (value.report ? " is-completed" : "")}>
        <div className="practice-question"><span className="practice-kicker"><MessageSquare size={15} /> 项目追问 · 01</span>
          <h3>{turn.question}</h3>
          <p>结合你实际负责的部分回答；没有做过或尚未验证的内容，可以直接说明。</p>
          {value.modelMode && <small>{value.modelMode === "demo" ? "规则演示，非AI评估" : "真实AI反馈，技术建议仍需核对"}</small>}
        </div>
        {!value.report && <div className="practice-answer"><label>体验回答
          <textarea rows={6} maxLength={3000} disabled={busy || disabled || waiting || loadError || submitted} value={answer} onChange={e => edit(e.target.value)} placeholder="从你的职责、具体实现和验证方式说起…" />
        </label><div className="practice-answer-actions"><small>{answer.length} / 3000</small>{action}</div></div>}
      </div>}
      {value.report && <div className="practice-feedback"><h3>针对你的回答</h3>
        <ul className="practice-strengths">{value.report.clearParts.map((s, i) => <li key={i}><Check size={15} />{s}</li>)}</ul>
        <div className="practice-findings">{value.report.findings.map((f, i) => <article key={i}>
          <span className="practice-kicker">改进方向 {String(i + 1).padStart(2, "0")}</span><h4>{f.topic}</h4>
          <p>{f.assessment}</p>{f.supportExplanation && <p>判断依据（AI说明）：{f.supportExplanation}</p>}<p className="practice-task"><strong>{i === 0 ? "优先完成" : "下一步"}</strong>{f.task}</p>
          {f.evidence.length > 0 && <details><summary>查看回答依据</summary>{f.evidence.map((e, n) => <blockquote key={e.turnId + n}>{e.quote}</blockquote>)}</details>}
        </article>)}</div>
        <p className="practice-footnote">想连续深挖？核对项目事实后，可使用训练包开始完整训练。</p>
        <PracticeNext projectId={projectId} answer={turn?.answer || ""} disabled={disabled}
          onSaved={onSaved} onReview={onReview} run={run} busy={busy} />
      </div>}
      {disabled && <p className="practice-footnote">请先保存当前材料或事实核对修改，再继续体验。</p>}
      {!turn && <p className="practice-footnote">体验不能代替完整事实核对与训练。</p>}
    </>}{notice && <p className="practice-footnote" role="status">{notice}</p>}{error && <p className="practice-error" role="alert">{error}</p>}
    </div>
  </section>;
}

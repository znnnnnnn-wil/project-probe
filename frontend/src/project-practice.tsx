import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import type { Report, Turn } from "./types";

type Practice = { status: string; turns?: Turn[]; report?: Report; modelMode?: string };
export function ProjectPractice({ projectId, disabled, run, busy }: Actions & { projectId: string; disabled: boolean }) {
  const [value, setValue] = useState<Practice>({ status: "AVAILABLE" });
  const [answer, setAnswer] = useState(""); const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController();
    api<Practice>(`/projects/${projectId}/practice`, "GET", undefined, controller.signal).then(setValue).catch(() => {});
    return () => controller.abort();
  }, [projectId]);
  const submit = () => run(async () => { setError(""); try {
    const next = await api<Practice>(`/projects/${projectId}/practice`, "POST", answer.trim() ? { answer } : {}); setValue(next);
  } catch (e) { setError(e instanceof Error ? e.message : "体验失败"); setValue(v => ({ ...v, status: "FAILED" })); } });
  return <section className="panel" aria-label="我的项目一题体验"><h2>先用自己的项目体验一题</h2>
    <p>每账号一次，不需购买训练包；使用已保存的材料。体验不能代替完整事实核对与训练。</p>
    {value.status === "USED" ? <p>本账号已体验，可使用训练包继续练习。</p> : <>
      {value.modelMode && <p>{value.modelMode === "demo" ? "规则演示，非AI评估" : "真实AI反馈，技术建议仍需核对"}</p>}
      {value.turns?.[0] && <><h3>{value.turns[0].question}</h3>
        {!value.report && <label>体验回答<textarea rows={3} maxLength={3000} value={answer} onChange={e => setAnswer(e.target.value)} /></label>}</>}
      {value.report ? <><h3>针对你的回答</h3>{value.report.clearParts.map((s, i) => <p key={i}>{s}</p>)}
        {value.report.findings.map((f, i) => <div key={i}><strong>{f.topic}</strong><p>{f.assessment}</p><p>下一步：{f.task}</p>
          {f.evidence.map(e => <blockquote key={e.turnId}>{e.quote}</blockquote>)}</div>)}
        <p>想连续深挖？核对项目事实后，可使用训练包开始完整训练。</p></> :
        <Button secondary disabled={busy || disabled || (value.status === "ACTIVE" && !answer.trim())} onClick={submit}>
          {value.status === "ACTIVE" ? "提交体验回答" : value.status === "AVAILABLE" ? "开始一题体验" : "重试或恢复体验"}</Button>}
    </>}{error && <p role="alert">{error}</p>}
  </section>;
}

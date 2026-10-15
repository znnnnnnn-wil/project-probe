import React, { useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Training } from "./types";
import type { Actions } from "./ui";

export function TrainingHelp({ training, run, busy, onUpdated, onUnknown }: Actions & {
  training: Training; onUpdated: (t: Training) => void; onUnknown: () => void;
}) {
  const [kind, setKind] = useState("CORRECT");
  const [detail, setDetail] = useState("");
  const [notice, setNotice] = useState("");
  const send = (action: string) => run(async () => {
    const result = await api<Training>(`/trainings/${training.id}/support`, "POST", {
      turnId: training.turns.at(-1)?.id, kind: action, detail, requestKey: crypto.randomUUID(),
    });
    onUpdated(result); setDetail("");
    setNotice(action === "FEEDBACK" ? "问题反馈已保存。" : "题目已调整，已有草稿保留；不额外扣次数。");
  });
  return <details className="panel"><summary>暂时不会、澄清题意或反馈问题</summary>
    <div className="action-row">
      <Button secondary disabled={busy} onClick={onUnknown}>暂时不会，记录后继续</Button>
      <Button secondary disabled={busy} onClick={() => send("CLARIFY")}>请解释题意</Button>
    </div>
    <label>问题类型<select value={kind} onChange={e => setKind(e.target.value)}>
      <option value="CORRECT">题目假设不符合我的项目</option><option value="FEEDBACK">反馈重复或不准确的问题</option>
    </select></label>
    <label>具体说明<textarea rows={3} maxLength={1000} value={detail} onChange={e => setDetail(e.target.value)} /></label>
    <Button secondary disabled={busy || !detail.trim()} onClick={() => send(kind)}>
      {kind === "CORRECT" ? "提交纠正并调整题目" : "保存问题反馈"}</Button>
    <p>调整原题不扣额外次数，每题最多3次。反馈与原题会保存，草稿不会自动提交。</p>
    {notice && <p role="status">{notice}</p>}
  </details>;
}

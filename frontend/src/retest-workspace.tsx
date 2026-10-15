import React, { useEffect, useRef, useState } from "react";
import { api, go } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import type { Project, Training, TrainingSummary } from "./types";

export function RetestWorkspace({ training, run, busy }: Actions & { training: Training }) {
  const [project, setProject] = useState<Project | null>(null);
  const [rounds, setRounds] = useState<TrainingSummary[]>([]);
  const [focus, setFocus] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState("");
  const [notice, setNotice] = useState("");
  const key = useRef(crypto.randomUUID());
  const topics = [...new Set([
    ...(training.report?.findings.map(f => f.topic) || []),
    ...(training.report?.retestTopics || []),
  ])];
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<Project>("/projects/" + training.project.id, "GET", undefined, controller.signal),
      api<TrainingSummary[]>("/trainings?summary=true&project=" + training.project.id, "GET", undefined, controller.signal),
    ]).then(([p, items]) => {
      if (controller.signal.aborted) return;
      setProject(p);
      setRounds(items.filter(t => t.parentId === training.id));
    }).catch(() => { if (!controller.signal.aborted) setNotice("暂未读取到最新材料，请重新打开报告后重试。"); });
    return () => controller.abort();
  }, [training.id]);
  const notes = training.reportPlan?.filter(task => task.note.trim()) || [];
  const prepare = () => run(async () => {
    const current = await api<Project>("/projects/" + training.project.id);
    setProject(current);
    const additions = notes.filter(n => selected.includes(n.taskIndex)).map(n =>
      `补充笔记（用户提供，未独立验证）· ${training.report?.findings[n.taskIndex]?.topic || "复盘"}\n${n.note.trim()}`,
    ).join("\n\n");
    setPreview([current.materials, additions].filter(Boolean).join("\n\n"));
    setNotice("");
  });
  return <section className="panel" aria-label="复盘与专项复测">
    <h2>带着补充内容，再练一个薄弱点</h2>
    {notes.length > 0 && <fieldset>
      <legend>选择已保存笔记，预览后加入项目材料</legend>
      {notes.map(n => <label className="checkbox" key={n.taskIndex}>
        <input type="checkbox" checked={selected.includes(n.taskIndex)} onChange={e => {
          setSelected(e.target.checked ? [...selected, n.taskIndex] : selected.filter(i => i !== n.taskIndex));
          setPreview("");
        }} />{training.report?.findings[n.taskIndex]?.topic || "补充笔记"}
      </label>)}
      <Button secondary disabled={busy || selected.length === 0} onClick={prepare}>预览加入材料</Button>
    </fieldset>}
    {preview && <div>
      <label>加入后的材料预览<textarea rows={6} value={preview} readOnly /></label>
      <p>保存后需重新核对事实。原报告和笔记保留。</p>
      <Button disabled={busy || preview.length > 12000} onClick={() => run(async () => {
        if (!project) return;
        const saved = await api<Project>("/projects/" + project.id, "PUT", { ...project, materials: preview });
        setProject(saved); setPreview(""); setSelected([]);
        setNotice("补充已加入材料，请前往项目重新提取并核对事实。");
      })}>确认保存到项目材料</Button>
      {preview.length > 12000 && <p role="alert">材料超过12000字，请先在项目中整理。</p>}
    </div>}
    <label>本轮复测主题<select aria-label="本轮复测主题" value={focus} onChange={e => {
      setFocus(e.target.value); key.current = crypto.randomUUID();
    }}><option value="">请选择一个薄弱点</option>{topics.map(topic =>
      <option key={topic} value={topic}>{topic}</option>,
    )}</select></label>
    <ul>{topics.map(topic => {
      const related = rounds.filter(r => r.focus === topic && r.status !== "REFUNDED");
      const ongoing = related.find(r => r.status !== "COMPLETED");
      return <li key={topic}>{topic} · {ongoing ? "进行中" : related.length ? `已复测 ${related.length} 次` : "未复测"}
        {related.map(r => <p key={r.id}><a href={`#/${r.status === "COMPLETED" ? "report" : "trainings"}/${r.id}`}>
          {r.status === "COMPLETED" ? "查看复测结果" : "继续复测"}</a></p>)}
      </li>;
    })}</ul>
    <p>每新开一轮消耗1次，继续已有训练不重复扣次。仍有进行中的复测时优先恢复。</p>
    <Button disabled={busy || !focus || !project?.factsConfirmed} onClick={() => run(async () => {
      const result = await api<Training>("/trainings", "POST", {
        projectId: training.project.id, parentId: training.id, focus, newRound: true, requestKey: key.current,
      });
      go(`/${result.status === "COMPLETED" ? "report" : "trainings"}/${result.id}`);
    })}>开始所选主题复测</Button>
    <p><a href={"#/projects/" + training.project.id}>整理材料与核对事实</a></p>
    {notice && <p role="status">{notice}</p>}
  </section>;
}

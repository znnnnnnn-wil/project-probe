import { useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import type { Project } from "./types";

export function PracticeNext({ projectId, answer, disabled, onSaved, onReview, run, busy }: Actions & {
  projectId: string; answer: string; disabled: boolean; onSaved: (project: Project) => void; onReview: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [preview, setPreview] = useState("");
  const [notice, setNotice] = useState("");
  return <section className="practice-next" aria-label="体验后的下一步">
    <h3>把刚才讲清楚的内容，带到下一轮</h3>
    <p>① 补充项目材料（可选） → ② 提取并核对事实 → ③ 开始完整深挖</p>
    <div className="action-row">
      <Button secondary disabled={busy || disabled || !answer.trim()} onClick={() => run(async () => {
        const current = await api<Project>("/projects/" + projectId);
        const addition = "一题体验补充（用户自述，未独立验证）\n" + answer.trim();
        setProject(current);
        if (current.materials.includes(addition)) { setNotice("这段回答已在项目材料中，无需重复加入。"); setPreview(""); return; }
        setPreview([current.materials, addition].filter(Boolean).join("\n\n")); setNotice("");
      })}>预览回答补充到材料</Button>
      <Button secondary disabled={busy || disabled} onClick={onReview}>前往事实核对</Button>
    </div>
    {preview && <div className="practice-material-preview">
      <label>项目材料补充预览<textarea rows={6} value={preview} maxLength={12000} onChange={e => setPreview(e.target.value)} /></label>
      <p>仅保存你的说明，不自动加入AI建议；保存后原核对失效，需要重新提取与核对。</p>
      <div className="action-row"><Button disabled={busy || disabled || !preview.trim() || preview.length > 12000} onClick={() => run(async () => {
        if (!project) return;
        const saved = await api<Project>("/projects/" + projectId, "PUT", { ...project, materials: preview });
        setPreview(""); setNotice("回答已加入材料，原体验报告保留。请重新提取并核对事实。"); onSaved(saved);
      })}>确认保存回答补充</Button><Button secondary disabled={busy} onClick={() => setPreview("")}>取消补充</Button></div>
      {preview.length > 12000 && <p role="alert">补充后超过12000字，请整理后再保存。</p>}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

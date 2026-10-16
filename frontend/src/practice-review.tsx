import { useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";

export function PracticeReview({ projectId, run, busy }: Actions & { projectId: string }) {
  const [score, setScore] = useState(0), [again, setAgain] = useState("");
  const [price, setPrice] = useState("尚未回答"), [detail, setDetail] = useState("");
  const [saved, setSaved] = useState(!!sessionStorage.getItem("practice-review:" + projectId));
  return <section className="practice-review" aria-label="自愿体验反馈"><h3>这次练习对你有帮助吗？</h3>
    <p>自愿填写，不影响训练权益；反馈仅保存在站内。</p>
    {saved ? <p role="status">已记录这次体验反馈，感谢你帮助改进产品。</p> : <>
      <div role="group" aria-label="帮助程度"><span>帮助程度（1分很少，5分很有帮助）</span><div className="review-choices">{[1, 2, 3, 4, 5].map(n =>
        <button key={n} type="button" aria-pressed={score === n} disabled={busy} onClick={() => setScore(n)}>{n}分</button>)}</div></div>
      <div role="group" aria-label="是否愿意继续使用"><span>是否愿意用它练习另一个项目？</span><div className="review-choices">{["愿意继续", "还不确定", "暂时不愿意"].map(value =>
        <button key={value} type="button" aria-pressed={again === value} disabled={busy} onClick={() => setAgain(value)}>{value}</button>)}</div></div>
      <div role="group" aria-label="训练包意愿"><span>对训练包的想法（可选）</span><div className="review-choices">{["愿意考虑购买", "需要更多体验", "暂无购买意愿"].map(value =>
        <button key={value} type="button" aria-pressed={price === value} disabled={busy} onClick={() => setPrice(value)}>{value}</button>)}</div></div>
      <label>最卡住的一步（可选）<textarea rows={2} maxLength={500} value={detail} onChange={e => setDetail(e.target.value)} /></label>
      <Button secondary disabled={busy || !score || !again} onClick={() => run(async () => {
        await api("/feedback", "POST", { kind: "GENERAL", requestKey: "trial-review-" + projectId,
          detail: `体验调研（用户自报，非付费记录）\n项目：${projectId}\n帮助程度：${score}/5\n再次使用：${again}\n训练包意愿：${price}\n卡点：${detail.trim() || "未填写"}` });
        sessionStorage.setItem("practice-review:" + projectId, "saved"); setSaved(true);
      })}>保存体验反馈</Button>
    </>}
  </section>;
}

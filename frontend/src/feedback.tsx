import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import { TrainingSelect } from "./training-select";

type Feedback = { id: string; kind: string; body: string; status: string; reply: string };
export function FeedbackForm({ run, busy }: Actions) {
  const [items, setItems] = useState<Feedback[]>([]); const [kind, setKind] = useState("GENERAL");
  const [detail, setDetail] = useState(""); const [requestId, setRequestId] = useState("");
  const [notice, setNotice] = useState(""); const key = useRef(crypto.randomUUID());
  useEffect(() => { const controller = new AbortController();
    api<Feedback[]>("/feedback", "GET", undefined, controller.signal).then(setItems).catch(() => {});
    return () => controller.abort();
  }, []);
  return <section className="panel"><h2>问题与售后反馈</h2><p>反馈保存在站内，可在这里查看处理回复；不发送外部消息。不填写密码、恢复码或支付凭据。</p>
    <TrainingSelect label="反馈类型" value={kind} onChange={setKind} disabled={busy} options={[{ value: "GENERAL", label: "产品体验" }, { value: "PAYMENT", label: "订单与支付" }, { value: "ACCOUNT", label: "账户与数据" }]} />
    <label>问题描述<textarea rows={3} value={detail} maxLength={2000} onChange={e => setDetail(e.target.value)} /></label>
    <label>请求编号（可选）<input value={requestId} maxLength={36} onChange={e => setRequestId(e.target.value)} /></label>
    <Button disabled={busy || !detail.trim()} onClick={() => run(async () => {
      const result = await api<{ id: string }>("/feedback", "POST", { kind, detail, requestId, requestKey: key.current });
      setNotice("反馈已保存，编号：" + result.id); setDetail(""); setRequestId(""); key.current = crypto.randomUUID();
      setItems(await api<Feedback[]>("/feedback"));
    })}>保存反馈</Button>
    {notice && <p role="status">{notice}</p>}
    {items.map(item => <article key={item.id}><h3>{item.status === "RESOLVED" ? "已处理" : "待处理"} · {item.id}</h3><p>{item.body}</p>
      {item.reply && <blockquote>{item.reply}</blockquote>}</article>)}
  </section>;
}

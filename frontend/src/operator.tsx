import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { Button, PageHead } from "./ui";
import type { Actions } from "./ui";
import { TrainingSelect } from "./training-select";
import "./operator.css";

type Row = {
  id: string;
  kind: string;
  body: string;
  request_id?: string;
  status: string;
  reply: string;
};
type Metrics = {
  journey: {
    paymentMode: string;
    stages: { event: string; users: number; events: number }[];
    note: string;
  };
  modelAttempts: {
    payment_mode: string;
    model_name: string;
    outcome: string;
    attempts: number;
    mean_ms: number;
  }[];
  textCosts: {
    payment_mode: string;
    responses: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_micros: number;
    unpriced_calls: number;
  }[];
  costNote: string;
};
const stages: Record<string, string> = {
  REGISTERED: "注册",
  MATERIAL_SAVED: "保存材料",
  FACTS_CONFIRMED: "核对事实",
  TRIAL_STARTED: "开始体验",
  TRIAL_COMPLETED: "完成体验",
  TRAINING_STARTED: "开始深挖",
  RETEST_STARTED: "开始复测",
  REPORT_COMPLETED: "生成报告",
  REPORT_VIEWED: "查看报告",
};
export function Operator({ run, busy }: Actions) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [status, setStatus] = useState("OPEN"),
    [search, setSearch] = useState("");
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0),
    [more, setMore] = useState(false);
  const [reply, setReply] = useState(""),
    [selected, setSelected] = useState<Row | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const access = await api<{ operator: boolean }>(
          "/account/access",
          "GET",
          undefined,
          signal,
        );
        if (!access.operator)
          throw Error("此账号没有运营权限，请使用已配置的运营账号登录。");
        const [m, feedback] = await Promise.all([
          api<Metrics>("/operator/metrics", "GET", undefined, signal),
          api<{ items: Row[]; total: number; hasMore: boolean }>(
            `/operator/feedback-page?status=${status}&search=${encodeURIComponent(query)}&offset=${offset}`,
            "GET",
            undefined,
            signal,
          ),
        ]);
        if (signal?.aborted) return;
        setMetrics(m);
        setItems(feedback.items);
        setTotal(feedback.total);
        setMore(feedback.hasMore);
      } catch (e) {
        if (!signal?.aborted)
          setError(e instanceof Error ? e.message : "读取失败");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [status, query, offset],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  return (
    <section className="page operator-page">
      <PageHead
        eyebrow="运营"
        title="服务与反馈工作台"
        text="查看阶段触达、模型尝试和站内待处理问题。"
        action={
          <Button
            secondary
            disabled={loading || busy}
            onClick={() => void load()}
          >
            刷新工作台
          </Button>
        }
      />
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">正在读取…</p>}
      {metrics && (
        <>
          <section className="panel">
            <h2>注册后的阶段触达 · {metrics.journey.paymentMode}</h2>
            <div className="operator-stages">
              {Object.entries(stages).map(([key, label]) => {
                const stage = metrics.journey.stages.find(
                  (s) => s.event === key,
                );
                return (
                  <div key={key}>
                    <span>{label}</span>
                    <strong>
                      {stage?.users || 0}
                      <small> 人</small>
                    </strong>
                    <small>{stage?.events || 0} 条阶段记录</small>
                  </div>
                );
              })}
            </div>
            <p>{metrics.journey.note}</p>
          </section>
          <section className="panel">
            <h2>文本模型尝试与成本边界</h2>
            {metrics.modelAttempts.length ? (
              metrics.modelAttempts.map((a, i) => (
                <p key={i}>
                  {a.payment_mode} · {a.model_name} ·{" "}
                  {a.outcome === "SUCCEEDED" ? "返回可解析结果" : "失败"}{" "}
                  {a.attempts} 次 · 平均 {(a.mean_ms / 1000).toFixed(1)} 秒
                </p>
              ))
            ) : (
              <p>暂无新增模型尝试记录。</p>
            )}
            {metrics.textCosts.map((c, i) => (
              <p key={i}>
                {c.payment_mode} · {c.responses} 份文本用量 · 输入{" "}
                {c.input_tokens} / 输出 {c.output_tokens} token ·{" "}
                {c.unpriced_calls
                  ? `${c.unpriced_calls} 次价格未知，不能给出完整费用`
                  : `配置单价估算 ¥${(c.estimated_cost_micros / 1000000).toFixed(4)}`}
              </p>
            ))}
            <p>{metrics.costNote}</p>
          </section>
          <section className="panel">
            <h2>站内反馈 · {total} 条</h2>
            <div className="operator-filters">
              <TrainingSelect
                label="处理状态"
                value={status}
                onChange={(value) => {
                  setStatus(value);
                  setOffset(0);
                }}
                disabled={busy || loading}
                options={[
                  { value: "OPEN", label: "待处理" },
                  { value: "RESOLVED", label: "已处理" },
                  { value: "ALL", label: "全部" },
                ]}
              />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setOffset(0);
                  setQuery(search.trim());
                }}
              >
                <label>
                  反馈或请求编号
                  <input
                    value={search}
                    maxLength={100}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <Button secondary disabled={busy || loading} type="submit">
                  查询反馈
                </Button>
              </form>
            </div>
            {items.map((item) => (
              <article className="operator-feedback" key={item.id}>
                <h3>
                  {item.status === "OPEN" ? "待处理" : "已处理"} · {item.kind}
                </h3>
                <small>
                  反馈编号：{item.id}
                  {item.request_id && ` · 请求编号：${item.request_id}`}
                </small>
                <p>{item.body}</p>
                {item.reply && <blockquote>{item.reply}</blockquote>}
                <Button
                  secondary
                  disabled={busy || loading}
                  onClick={() => {
                    setSelected(item);
                    setReply(item.reply);
                  }}
                >
                  处理这条反馈
                </Button>
              </article>
            ))}
            {!items.length && <p>当前筛选下没有反馈。</p>}
            <div className="action-row">
              <Button
                secondary
                disabled={busy || loading || offset === 0}
                onClick={() => setOffset(offset - 20)}
              >
                上一页反馈
              </Button>
              <Button
                secondary
                disabled={busy || loading || !more}
                onClick={() => setOffset(offset + 20)}
              >
                下一页反馈
              </Button>
            </div>
            {selected && (
              <form
                className="operator-reply"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await api(`/operator/feedback/${selected.id}`, "POST", {
                      reply,
                      status: "RESOLVED",
                      expectedReply: selected.reply,
                      expectedStatus: selected.status,
                    });
                    setSelected(null);
                    setReply("");
                    await load();
                  });
                }}
              >
                <h3>回复反馈 {selected.id}</h3>
                <label>
                  站内处理回复
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                </label>
                <p>回复仅保存在站内；不会发送邮件或外部消息。</p>
                <div className="action-row">
                  <Button type="submit" disabled={busy || !reply.trim()}>
                    保存回复并标记已处理
                  </Button>
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => setSelected(null)}
                  >
                    取消处理
                  </Button>
                </div>
              </form>
            )}
          </section>
        </>
      )}
    </section>
  );
}

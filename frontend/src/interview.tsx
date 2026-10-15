import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowRight,
  MessageSquare,
  RefreshCw,
  Check,
  ShieldCheck,
  Layers,
  LoaderCircle,
  Target,
} from "lucide-react";
import { api, go } from "./api";
import type { Training } from "./types";
import { VoiceInput } from "./voice-input";
import { Button, Loading, PageHead, sourceLabel, statusLabel } from "./ui";
import type { Actions } from "./ui";

export function Interview({ id, run, busy }: Actions & { id: string }) {
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [t, setT] = useState<Training | null>(null);
  const [answer, setAnswer] = useState("");
  const mounted = useRef(true);
  const reading = useRef<AbortController | null>(null);
  const readVersion = useRef(0);
  const submitting = useRef(false);
  const load = useCallback(async () => {
    if (!mounted.current || submitting.current) return;
    const version = ++readVersion.current;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    try {
      const value = await api<Training>(
        "/trainings/" + id,
        "GET",
        undefined,
        controller.signal,
      );
      if (!mounted.current || version !== readVersion.current) return;
      setT(value);
      if (value.status === "COMPLETED") go("/report/" + id);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        mounted.current &&
        version === readVersion.current
      )
        throw error;
    } finally {
      if (reading.current === controller) reading.current = null;
    }
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    run(load);
    return () => {
      mounted.current = false;
      ++readVersion.current;
      reading.current?.abort();
    };
  }, [load, run]);
  const turn = t?.turns[t.turns.length - 1];
  useEffect(() => {
    setAnswer(
      turn?.answer ||
        sessionStorage.getItem("draft:" + id + ":" + turn?.id) ||
        "",
    );
  }, [id, turn?.id, turn?.answer]);
  useEffect(() => {
    if (t && ["GENERATING", "PENDING"].includes(t.status)) {
      let cancelled = false;
      let timer: number;
      const poll = async () => {
        try {
          await load();
        } catch {
          /* 下一次轮询或手动操作可恢复。 */
        }
        if (!cancelled) timer = window.setTimeout(poll, 3000);
      };
      timer = window.setTimeout(poll, 3000);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
  }, [t?.status, load]);
  const action = (suffix: string, data?: unknown) =>
    run(async () => {
      if (submitting.current) return;
      submitting.current = true;
      ++readVersion.current;
      reading.current?.abort();
      try {
        const result = await api<Training>(
          "/trainings/" + id + "/" + suffix,
          "POST",
          data,
        );
        if (suffix === "answer")
          sessionStorage.removeItem("draft:" + id + ":" + turn?.id);
        if (!mounted.current) return;
        setT(result);
        if (result.status === "COMPLETED") go("/report/" + id);
      } finally {
        submitting.current = false;
        // 刷新失败不能覆盖提交本身的错误或已确认结果。
        await load().catch(() => {});
      }
    });
  if (!t) return <Loading />;
  const count = t.turns.filter((v) => v.answer).length;
  return (
    <section className="page interview-page">
      <PageHead
        eyebrow={
          t.kind === "RETEST"
            ? "专项复测 · 换个场景检查理解"
            : "项目深挖 · 一次只聚焦一个问题"
        }
        title={t.project.name}
        text="如实描述你做过的部分。不确定的地方可以直接说，我们会把它记为待补充。"
        action={
          <span className="badge">
            <span className="status-dot" />
            {statusLabel[t.status]}
          </span>
        }
      />
      <div className="interview-layout">
        <aside className="panel progress-panel">
          <h3>本次练习</h3>
          <div className="progress-number">
            {count.toString().padStart(2, "0")}
            <small> / {t.maxTurns.toString().padStart(2, "0")}</small>
          </div>
          <p>个回答已保存</p>
          <div className="progress-bar">
            <span style={{ width: (count / t.maxTurns) * 100 + "%" }} />
          </div>
          {t.turns.map((v, i) => (
            <div
              className={"progress-item " + (!v.answer ? "current" : "")}
              key={v.id}
            >
              <span>{v.answer ? <Check size={13} /> : i + 1}</span>
              {v.topic}
            </div>
          ))}
          <div className="aside-note">
            <ShieldCheck size={17} />
            <p>已提交内容保存在服务端；未提交草稿仅保留在当前浏览器标签页。</p>
          </div>
          <a href="#/history">离开并稍后继续</a>
          <details className="interview-materials">
            <summary>本轮事实边界</summary>
            {t.project.facts
              .filter((f) => f.confirmed)
              .slice(0, 6)
              .map((f) => (
                <p key={f.id}>
                  <span className="badge">{sourceLabel[f.source]}</span>
                  {f.text}
                </p>
              ))}
          </details>
        </aside>
        <div>
          <div className="panel question-panel">
            <div className="question-label">
              <span className="brand-icon">
                <MessageSquare size={18} />
              </span>
              追问官{" "}
              <span>问题 {t.turns.length.toString().padStart(2, "0")}</span>
            </div>
            <h2>{turn?.question || "正在准备专项复测首题"}</h2>
            <div className="question-context">
              <Layers size={14} /> 依据本次项目材料与已提交回答 ·{" "}
              {t.modelMode === "demo" ? "规则演示" : "AI 生成"}
            </div>
            {t.kind === "RETEST" && (
              <p className="focus-topic">
                <Target size={14} /> 本轮复测：{t.focus}
              </p>
            )}
            {t.turns.length > 1 && (
              <details className="previous-answer">
                <summary>上一问与我的回答</summary>
                <strong>{t.turns[t.turns.length - 2].question}</strong>
                <p>{t.turns[t.turns.length - 2].answer}</p>
              </details>
            )}
          </div>
          {t.status === "ACTIVE" && turn ? (
            <form
              className="panel answer-panel"
              onSubmit={(e) => {
                e.preventDefault();
                if (voiceBusy) return;
                action("answer", { turnId: turn.id, answer });
              }}
            >
              <label>
                你的回答
                <textarea
                  aria-label="你的回答"
                  autoFocus
                  rows={9}
                  maxLength={6000}
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value);
                    sessionStorage.setItem(
                      "draft:" + id + ":" + turn.id,
                      e.target.value,
                    );
                  }}
                  placeholder="从你的实际实现讲起：做了什么，为什么这样做，如何验证。如果尚未实现，请直接说明。"
                  required
                />
              </label>
              <VoiceInput
                key={turn.id}
                trainingId={id}
                turnId={turn.id}
                disabled={busy}
                remaining={6000 - answer.length - (answer.trim() ? 1 : 0)}
                onBusy={setVoiceBusy}
                onAppend={(text) => {
                  const next = answer + (answer.trim() ? "\n" : "") + text;
                  setAnswer(next);
                  sessionStorage.setItem("draft:" + id + ":" + turn.id, next);
                }}
              />
              <div className="answer-bottom">
                <span>{answer.length} / 6000</span>
                <Button
                  type="submit"
                  disabled={busy || voiceBusy || !answer.trim()}
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="spin" size={16} />
                      正在生成下一步…
                    </>
                  ) : (
                    <>
                      提交并继续 <ArrowRight size={16} />
                    </>
                  )}
                </Button>
              </div>
              <button
                type="button"
                className="text-link"
                disabled={busy || voiceBusy || count === 0}
                onClick={() => {
                  if (
                    answer.trim() &&
                    !window.confirm(
                      "当前草稿尚未提交。结束训练只使用已提交回答，是否继续？",
                    )
                  )
                    return;
                  action("finish");
                }}
              >
                结束训练并复盘（仅使用已提交回答）
              </button>
            </form>
          ) : (
            <div className="panel recovery">
              <h3>
                {t.status === "FAILED"
                  ? "生成遇到问题，回答仍在"
                  : "REFUNDED" === t.status
                    ? "次数已返还，记录仍保留"
                    : "正在准备下一步"}
              </h3>
              <p>
                {t.error ||
                  "可离开后从训练记录返回。若服务中断，生成任务超时后可恢复。"}
              </p>
              {["FAILED", "PENDING", "GENERATING"].includes(t.status) && (
                <div className="action-row">
                  <Button
                    disabled={
                      busy ||
                      (t.status === "GENERATING" && t.leaseUntil > Date.now())
                    }
                    onClick={() => action("retry")}
                  >
                    <RefreshCw size={16} /> 重试 / 恢复生成
                  </Button>
                  <Button
                    secondary
                    disabled={
                      busy ||
                      (t.status === "GENERATING" && t.leaseUntil > Date.now())
                    }
                    onClick={() => action("refund")}
                  >
                    终止并返还本次次数
                  </Button>
                </div>
              )}
            </div>
          )}
          <details className="panel transcript">
            <summary>查看已经提交的回答（{count}）</summary>
            {t.turns
              .filter((v) => v.answer)
              .map((v) => (
                <div key={v.id}>
                  <h4>{v.question}</h4>
                  <p>{v.answer}</p>
                  <span className="badge">面试补充 · 未独立验证</span>
                </div>
              ))}
          </details>
        </div>
      </div>
    </section>
  );
}

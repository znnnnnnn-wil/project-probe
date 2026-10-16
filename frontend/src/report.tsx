import React, { useState, useEffect } from "react";
import {
  ArrowRight,
  RefreshCw,
  Check,
  ShieldCheck,
  Target,
  Download,
  Printer,
  ChevronDown,
} from "lucide-react";
import { api, go } from "./api";
import type { Training, Report } from "./types";
import { downloadReport } from "./report-export";
import { Button, Loading, Empty, PageHead, sourceLabel } from "./ui";
import type { Actions } from "./ui";
import { RetestWorkspace } from "./retest-workspace";

function ReportTask({
  training,
  index,
  run,
  busy,
  onSaved,
}: Actions & {
  training: Training;
  index: number;
  onSaved: (value: Training) => void;
}) {
  const value = training.reportPlan?.find((task) => task.taskIndex === index);
  const key = "plan-draft:" + training.id + ":" + index;
  const [note, setNote] = useState(value?.note || "");
  const [done, setDone] = useState(value?.done || false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let draft: { note: string; done: boolean } | null = null;
    try {
      draft = JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      sessionStorage.removeItem(key);
    }
    setNote(typeof draft?.note === "string" ? draft.note : value?.note || "");
    setDone(
      typeof draft?.done === "boolean" ? draft.done : value?.done || false,
    );
  }, [key, value?.updatedAt]);
  const changed =
    note !== (value?.note || "") || done !== (value?.done || false);
  return (
    <form
      className="plan-task"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          setError("");
          try {
            const result = await api<Training>(
              "/trainings/" + training.id + "/plan",
              "POST",
              {
                taskIndex: index,
                note,
                done,
                version: training.planVersion || 0,
              },
            );
            sessionStorage.removeItem(key);
            onSaved(result);
            setSaved(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : "保存失败");
            throw err;
          }
        });
      }}
    >
      <label className="checkbox">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => {
            setDone(e.target.checked);
            setSaved(false);
            sessionStorage.setItem(
              key,
              JSON.stringify({ note, done: e.target.checked }),
            );
          }}
        />
        我已补充这项（自报进度）
      </label>
      <label>
        我的补充笔记
        <textarea
          aria-label={"补充笔记 " + (index + 1)}
          rows={3}
          maxLength={2000}
          value={note}
          placeholder="记录你补充的实现细节、测试证据或仍需确认的问题。"
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
            sessionStorage.setItem(
              key,
              JSON.stringify({ note: e.target.value, done }),
            );
          }}
        />
      </label>
      <div className="plan-save-row">
        <small role="status">
          {changed
            ? "笔记尚未保存"
            : saved || value
              ? "进度已保存"
              : "尚未补充"}{" "}
          · {note.length}/2000
        </small>
        <Button secondary type="submit" disabled={busy || !changed}>
          <Check size={14} />
          保存复盘进度
        </Button>
      </div>
      {error && <p className="action-error">{error}</p>}
    </form>
  );
}
function ReportBody({
  report,
  training,
  run,
  busy,
  onSaved,
}: Actions & {
  report: Report;
  training: Training;
  onSaved: (value: Training) => void;
}) {
  return (
    <>
      <div className="panel clear-panel">
        <div className="section-kicker">
          <Check size={15} /> 表达中清晰的部分
        </div>
        {report.clearParts.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
      </div>
      <div className="section-heading">
        <h2>把这些地方，再讲具体一点</h2>
        <span>{report.findings.length} 项补充任务</span>
      </div>
      {report.findings.map((f, i) => (
        <article className="panel finding" key={i}>
          <div className="finding-title">
            <span>{String(i + 1).padStart(2, "0")}</span>
            <h2>{f.topic}</h2>
            <span className="badge">待补充 / 待验证</span>
          </div>
          <p>{f.assessment}</p>
          {f.evidence.map((e) => (
            <blockquote key={e.turnId}>
              <small>你的原回答 · {e.question}</small>
              <p>{e.quote}</p>
            </blockquote>
          ))}
          {f.materials.length > 0 && (
            <details>
              <summary>查看对应材料依据（{f.materials.length}）</summary>
              {f.materials.map((f) => (
                <p key={f.id}>
                  <span className="badge">{sourceLabel[f.source]}</span>{" "}
                  {f.text}
                </p>
              ))}
            </details>
          )}
          <div className="task">
            <Target size={19} />
            <div>
              <strong>下一步，具体这样补</strong>
              <p>{f.task}</p>
            </div>
          </div>
          <details className="plan-details">
            <summary>
              记录补充进度与笔记 <ChevronDown size={15} />
            </summary>
            <ReportTask
              training={training}
              index={i}
              run={run}
              busy={busy}
              onSaved={onSaved}
            />
          </details>
        </article>
      ))}
    </>
  );
}
export function ReportPage({ id, run, busy }: Actions & { id: string }) {
  const [t, setT] = useState<Training | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    run(async () => {
      const value = await api<Training>(
        "/trainings/" + id,
        "GET",
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) setT(value);
      if (!controller.signal.aborted && value.status === "COMPLETED")
        api("/trainings/" + id + "/view", "POST").catch(() => {});
    });
    return () => controller.abort();
  }, [id, run]);
  if (!t) return <Loading />;
  if (!t.report)
    return (
      <Empty
        title="报告尚未生成"
        text="返回训练页面继续回答或恢复生成。"
        action={() => go("/trainings/" + id)}
      />
    );
  return (
    <section className="page report-page">
      <PageHead
        eyebrow={t.kind === "RETEST" ? "专项复测报告" : "项目深挖报告"}
        title={t.project.name + " · 复盘报告"}
        text={
          t.project.name +
          " · " +
          t.turns.filter((v) => v.answer).length +
          " 个回答 · " +
          (t.report.mode === "demo"
            ? "演示反馈，未进行 AI 技术评估"
            : "基于本轮材料与回答生成")
        }
        action={
          <div className="action-row">
            <button
              className="icon-button"
              title="下载 Markdown 报告（含已保存笔记）"
              aria-label="下载 Markdown 报告"
              onClick={() => downloadReport(t)}
            >
              <Download size={18} />
            </button>
            <button
              className="icon-button"
              title="打印或保存 PDF"
              aria-label="打印或保存 PDF"
              onClick={() => window.print()}
            >
              <Printer size={18} />
            </button>
          </div>
        }
      />
      <div className="report-summary">
        <div>
          <span>已保存回答</span>
          <strong>
            {t.turns.filter((v) => v.answer).length}
            <small>/{t.maxTurns}</small>
          </strong>
        </div>
        <div>
          <span>补充任务</span>
          <strong>{t.report.findings.length}</strong>
        </div>
        <div>
          <span>自报已补充</span>
          <strong>
            {t.reportPlan?.filter((task) => task.done).length || 0}
            <small>/{t.report.findings.length}</small>
          </strong>
        </div>
        <div>
          <span>反馈来源</span>
          <strong className="summary-mode">
            {t.report.mode === "demo" ? "规则演示" : "AI 模型"}
          </strong>
        </div>
      </div>
      <div className="report-layout">
        <div>
          <ReportBody
            report={t.report}
            training={t}
            run={run}
            busy={busy}
            onSaved={setT}
          />
          {t.kind === "DEEP" && <RetestWorkspace training={t} run={run} busy={busy} />}
          {t.kind === "RETEST" && (
            <section className="panel comparison">
              <h2>前后回答对照</h2>
              {t.report.comparisons?.map((item, i) => <article key={i}>
                <h3>{item.topic} · {({ EXPLAINED: "本轮已补充解释", PARTIAL: "部分补充",
                  UNRESOLVED: "仍待解释", NOT_COMPARABLE: "条件不同，不能直接比较", NEEDS_REVIEW: "待自行核对" } as Record<string, string>)[item.status]}</h3>
                <p>{item.assessment}</p>
                <p>仅比较回答中的解释，未执行代码或独立验证实现。</p>
                <div className="comparison-grid">{[item.previousEvidence, item.currentEvidence].map((group, index) =>
                  <div key={index}><h4>{index ? "本轮证据" : "上轮证据"}</h4>{group.map(e =>
                    <blockquote key={e.turnId}><small>{e.question}</small><p>{e.quote}</p></blockquote>,
                  )}</div>,
                )}</div>
              </article>)}
              <p>
                问题场景已变化。以下保留两轮原文供你检查新增解释，不用字数或总分代替理解程度。
              </p>
              <div className="comparison-grid">
                <div>
                  <h3>上次深挖</h3>
                  {t.previousTurns
                    ?.filter((v) => v.answer)
                    .map((v) => (
                      <div key={v.id}>
                        <h4>{v.question}</h4>
                        <p>{v.answer}</p>
                      </div>
                    ))}
                </div>
                <div>
                  <h3>本次复测</h3>
                  {t.turns
                    .filter((v) => v.answer)
                    .map((v) => (
                      <div key={v.id}>
                        <h4>{v.question}</h4>
                        <p>{v.answer}</p>
                      </div>
                    ))}
                </div>
              </div>
              <details>
                <summary>查看材料修订前后</summary>
                <h4>上次关键实现</h4>
                <p>{t.previousProject?.implementation || "未提供"}</p>
                <h4>本次关键实现</h4>
                <p>{t.project.implementation || "未提供"}</p>
                <h4>上次验证方式</h4>
                <p>{t.previousProject?.verification || "未提供"}</p>
                <h4>本次验证方式</h4>
                <p>{t.project.verification || "未提供"}</p>
              </details>
            </section>
          )}
        </div>
        <aside>
          <div className="panel report-next">
            <RefreshCw size={28} />
            <h2>{t.kind === "DEEP" ? "复盘之后，再练一次" : "继续补齐理解"}</h2>
            <div className="report-plan-progress">
              <span
                style={{
                  width:
                    (t.report.findings.length
                      ? (t.reportPlan?.filter((task) => task.done).length ||
                          0) / t.report.findings.length
                      : 0) *
                      100 +
                    "%",
                }}
              />
            </div>
            <p>
              先修订项目材料，再用新的场景练习。已完成的报告会保留当时的依据。
            </p>
            <h4>适合复测的主题</h4>
            {t.report.retestTopics.map((topic, i) => (
              <div className="topic" key={i}>
                <Target size={15} />
                {topic}
              </div>
            ))}
            <Button
              disabled={busy}
              onClick={() => { sessionStorage.setItem("project:expand:" + t.project.id, "true"); go("/projects/" + t.project.id); }}
            >
              补充材料{t.kind === "DEEP" ? "并复测" : ""}
              <ArrowRight size={16} />
            </Button>
            <a href="#/history">返回训练记录</a>
          </div>
          <div className="aside-note">
            <ShieldCheck size={18} />
            <p>
              没有总分，也没有录用保证。每条建议都应回到你自己的实现和证据。
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

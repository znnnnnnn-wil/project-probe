import React, { useState, useEffect } from "react";
import {
  ArrowRight,
  MessageSquare,
  RefreshCw,
  Check,
  ShieldCheck,
  Clock,
  LoaderCircle,
  Sparkles,
  CreditCard,
} from "lucide-react";
import { api, go, emptyProject, demoProject } from "./api";
import type { Project, Training, TrainingSummary, Shop, Fact } from "./types";
import { purchaseFrom } from "./workspace";
import { trainingQuota } from "./quota";
import { ResumeImport } from "./resume-import";
import { Button, Loading, PageHead, sourceLabel } from "./ui";
import type { Actions } from "./ui";
import { useMounted } from "./use-read-scope";
import { ProjectPractice } from "./project-practice";
import "./editor.css";
import { TrainingSelect } from "./training-select";

const fields: [keyof Project, string, string][] = [
  ["name", "项目名称", "例如：校园自习室预约系统"],
  ["targetRole", "目标岗位", "Java 后端实习"],
  ["stack", "技术栈", "例如：Spring Boot / PostgreSQL"],
  ["background", "项目背景与目标", "为谁解决什么问题？"],
  ["resume", "简历中的项目经历", "粘贴原文，不需要刻意润色"],
  [
    "responsibility",
    "个人职责（必填）",
    "明确你亲自完成、参与协作及不熟悉的部分",
  ],
  ["architecture", "架构说明", "请求经过哪些组件？数据如何流转？"],
  ["implementation", "关键实现", "选一个功能说明接口、表结构与处理步骤"],
  ["problems", "遇到的问题与方案", "当时的现象、原因、选择与取舍"],
  [
    "verification",
    "验证方式",
    "测试输入、预期结果、实际证据；未验证请直接说明",
  ],
  [
    "materials",
    "README / 脱敏代码片段（可选）",
    "仅粘贴相关文本，请删除密码、密钥和个人信息",
  ],
];
export function Editor({ id, run, busy }: Actions & { id: string }) {
  const mounted = useMounted();
  const [importBusy, setImportBusy] = useState(false);
  busy = busy || importBusy;
  const [p, setP] = useState<Project>({ ...emptyProject });
  const [loaded, setLoaded] = useState(id === "new");
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<TrainingSummary[]>([]);
  const [startKey] = useState(crypto.randomUUID());
  const [startError, setStartError] = useState("");
  const [starting, setStarting] = useState(false);
  const [exerciseMode, setExerciseMode] = useState("STANDARD");
  const [difficulty, setDifficulty] = useState("IMPLEMENTATION");
  const [step, setStep] = useState<"materials" | "facts">("materials");
  const [shop, setShop] = useState<Shop | null>(null);
  const [draftNotice, setDraftNotice] = useState("");
  const [factsDirty, setFactsDirty] = useState(false);
  const [expanded, setExpanded] = useState(id !== "new");
  const draftKey = "project-draft:" + id;
  const factDraftKey = "fact-draft:" + id;
  const restore = (project: Project) => {
    const raw = sessionStorage.getItem(draftKey);
    if (raw)
      try {
        const draft = JSON.parse(raw) as Project;
        if (
          draft.version === project.version &&
          typeof draft.name === "string" &&
          typeof draft.responsibility === "string"
        ) {
          setP({ ...project, ...draft });
          setDirty(true);
          setDraftNotice("已恢复此标签页未保存的材料");
          return;
        }
        setDraftNotice("材料已在其他页面更新，旧草稿未覆盖新版本");
      } catch {
        sessionStorage.removeItem(draftKey);
      }
    const factRaw = sessionStorage.getItem(factDraftKey);
    if (factRaw)
      try {
        const draft = JSON.parse(factRaw) as {
          version?: number;
          facts: Fact[];
        };
        if (
          draft.version === project.version &&
          Array.isArray(draft.facts) &&
          draft.facts.length === project.facts.length &&
          draft.facts.every(
            (fact, index) =>
              fact.id === project.facts[index].id &&
              typeof fact.text === "string" &&
              typeof fact.confirmed === "boolean",
          )
        ) {
          setP({ ...project, facts: draft.facts, factsConfirmed: false });
          setFactsDirty(true);
          setStep("facts");
          setDraftNotice("已恢复尚未保存的事实核对");
          return;
        }
        sessionStorage.removeItem(factDraftKey);
      } catch {
        sessionStorage.removeItem(factDraftKey);
      }
    setP(project);
  };
  useEffect(() => {
    const controller = new AbortController();
    if (id === "new") restore({ ...emptyProject });
    if (id !== "new")
      run(async () => {
        const [project, history] = await Promise.all([
          api<Project>("/projects/" + id, "GET", undefined, controller.signal),
          api<TrainingSummary[]>(
            "/trainings?summary=true&project=" + encodeURIComponent(id),
            "GET",
            undefined,
            controller.signal,
          ),
        ]);
        if (controller.signal.aborted) return;
        restore(project);
        setHistory(history);
        setLoaded(true);
      });
    api<Shop>("/shop?summary=true", "GET", undefined, controller.signal)
      .then((shop) => {
        if (!controller.signal.aborted) setShop(shop);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id, run]);
  useEffect(() => {
    if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(p));
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || factsDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [p, dirty, factsDirty, draftKey]);
  const editFacts = (facts: Fact[]) => {
    setP({ ...p, facts, factsConfirmed: false });
    setFactsDirty(true);
    sessionStorage.setItem(
      factDraftKey,
      JSON.stringify({ version: p.version, facts }),
    );
  };
  const save = () =>
    run(async () => {
      const result = await api<Project>(
        id === "new" ? "/projects" : "/projects/" + id,
        id === "new" ? "POST" : "PUT",
        p,
      );
      setP(result);
      setDirty(false);
      sessionStorage.removeItem(draftKey);
      sessionStorage.removeItem(factDraftKey);
      setFactsDirty(false);
      setDraftNotice("材料已保存");
      if (id === "new" && mounted.current) go("/projects/" + result.id);
    });
  const start = (parentId?: string) =>
    run(async () => {
      setStartError("");
      setStarting(!parentId);
      try {
        if (!parentId) setShop(await api<Shop>("/shop?summary=true"));
        const t = await api<Training>("/trainings", "POST", {
          projectId: id,
          parentId,
          exerciseMode, difficulty,
          requestKey: (parentId ? startKey.slice(0, 16) + "-retest-" + parentId : startKey) + exerciseMode + difficulty,
        });
        if (mounted.current)
          go((t.status === "COMPLETED" ? "/report/" : "/trainings/") + t.id);
      } catch (e) {
        if (!parentId)
          setStartError(e instanceof Error ? e.message : "开始失败，请重试");
        throw e;
      } finally {
        setStarting(false);
      }
    });
  if (!loaded) return <Loading />;
  const balance = trainingQuota(shop);
  const quota = shop ? balance.deepAvailable : undefined;
  const ongoing = history.filter(
    (t) => !["COMPLETED", "REFUNDED"].includes(t.status),
  );
  return (
    <section className="page editor-page">
      <PageHead
        eyebrow="项目档案"
        title={id === "new" ? "整理你的项目经历" : p.name}
        text={
          "Java 后端项目面试 · " +
          (id === "new" ? "新建档案" : "材料版本 " + p.version)
        }
        action={
          <Button secondary onClick={() => go("/projects")}>
            返回项目列表
          </Button>
        }
      />
      <div className="editor-steps" aria-label="项目准备步骤">
        <button
          aria-label="项目材料"
          aria-pressed={step === "materials"}
          disabled={factsDirty}
          onClick={() => setStep("materials")}
        >
          <span>{id !== "new" && !dirty ? <Check size={14} /> : "1"}</span>
          项目材料
        </button>
        <button
          aria-label="事实核对"
          aria-pressed={step === "facts"}
          disabled={id === "new"}
          onClick={() => setStep("facts")}
        >
          <span>{p.factsConfirmed && !dirty ? <Check size={14} /> : "2"}</span>
          事实核对
        </button>
        <div>
          <span>3</span>深挖与复测
        </div>
      </div>
      {draftNotice && (
        <p className="save-notice" role="status">
          {draftNotice}
        </p>
      )}
      {id !== "new" && <ProjectPractice projectId={id} disabled={dirty || factsDirty} run={run} busy={busy} />}
      <div className="editor-layout">
        <div className="materials-panel" hidden={step !== "materials"}>
          <div className="panel-heading">
            <h2>项目材料</h2>
            {id === "new" && (
              <button
                className="text-link"
                onClick={() => {
                  setP({ ...demoProject });
                  setDirty(true);
                }}
              >
                载入合成示例 <Sparkles size={14} />
              </button>
            )}
          </div>
          <p className="material-privacy">
            <ShieldCheck size={15} />
            材料用于 AI
            提取与追问，并保存在服务端。请移除密钥、个人身份信息和无权提供的代码。
          </p>
          <ResumeImport
            disabled={busy || factsDirty}
            onBusy={setImportBusy}
            onSelect={(candidate) => {
              if (
                (p.name.trim() || p.responsibility.trim() || p.resume.trim()) &&
                !window.confirm(
                  "将用选中的简历项目替换当前材料草稿，已保存的服务器记录不会立即修改。是否继续？",
                )
              )
                return;
              setP({
                ...p,
                ...candidate,
                targetRole: candidate.targetRole || p.targetRole,
                materials: "",
                facts: [],
                factsConfirmed: false,
              });
              setDirty(true);
              setDraftNotice("已填入简历项目，请核对后保存");
            }}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="form-fields">
              {fields.filter(([key]) => expanded || ["name", "targetRole", "responsibility"].includes(key)).map(([key, label, placeholder], i) => (
                <label key={key} className={i < 3 ? "" : "wide"}>
                  {label}
                  {["name", "targetRole", "stack"].includes(key) ? (
                    <input
                      aria-label={label}
                      value={String(p[key] ?? "")}
                      placeholder={placeholder}
                      maxLength={key === "name" ? 100 : 12000}
                      onChange={(e) => {
                        setP({ ...p, [key]: e.target.value });
                        setDirty(true);
                      }}
                      required={key === "name"}
                    />
                  ) : (
                    <textarea
                      aria-label={label}
                      rows={key === "materials" ? 6 : 3}
                      value={String(p[key] ?? "")}
                      placeholder={placeholder}
                      maxLength={12000}
                      onChange={(e) => {
                        setP({ ...p, [key]: e.target.value });
                        setDirty(true);
                      }}
                      required={key === "responsibility"}
                    />
                  )}
                </label>
              ))}
            </div>
            <button type="button" className="text-link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? "收起补充材料" : "展开技术栈、实现与验证等补充材料"}
            </button>
            <p>可以先填写项目名称和个人职责并保存，再体验一题；完整训练前可继续补充和核对。</p>
            <div className="form-bottom">
              <span>
                {dirty ? "有尚未保存的修改" : "材料已载入；保存后可提取事实"}
              </span>
              <Button type="submit" disabled={busy}>
                保存项目材料 <Check size={16} />
              </Button>
            </div>
          </form>
          {id !== "new" && (
            <div className="material-next">
              <span>
                {dirty ? "保存修改后再核对事实" : "材料已准备，可进入事实核对"}
              </span>
              <Button
                secondary
                disabled={busy || dirty}
                onClick={() => setStep("facts")}
              >
                前往事实核对
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
        </div>
        <div className="facts-panel" hidden={step !== "facts"}>
          <div className="section-kicker">02 · 开始前，先确认</div>
          <h2>项目事实清单</h2>
          <p>
            区分原始材料、推断与待确认信息。核对不意味着每条推断都已被证实。
          </p>
          {id === "new" ? (
            <div className="mini-empty">保存档案后，提取需要核对的事实。</div>
          ) : (
            <>
              {!p.facts.length && <div className="facts-empty">
                <span className="facts-empty-icon"><ShieldCheck size={28} strokeWidth={1.5} /></span>
                <h3>让追问建立在你的真实经历上</h3>
                <p>从已保存的材料中整理项目职责与实现细节，再由你逐条核对。暂时不确定的内容可以保留待确认。</p>
                <div className="facts-legend"><span>材料提供</span><span>AI 推断</span><span>待确认</span></div>
              </div>}
              <Button
                secondary
                disabled={busy || dirty || factsDirty}
                onClick={() =>
                  run(async () => {
                    setP(await api("/projects/" + id + "/extract", "POST"));
                    setDraftNotice("");
                  })
                }
              >
                {p.facts.length ? "读取已提取事实" : "提取项目事实"}
              </Button>
              <small>
                相同材料复用已提取结果；更新材料并保存后可重新提取。
              </small>
              {factsDirty && (
                <p className="save-notice">
                  核对修改尚未保存。未确认的条目会继续保留待确认状态。
                </p>
              )}
              <div className="fact-review-list">
                {p.facts.map((f, index) => (
                  <div className="fact" key={f.id}>
                    <span className={"badge source-" + f.source}>
                      {sourceLabel[f.source]}
                    </span>
                    <textarea
                      aria-label={"事实 " + (index + 1)}
                      rows={3}
                      value={f.text}
                      onChange={(e) =>
                        editFacts(
                          p.facts.map((v, i) =>
                            i === index ? { ...v, text: e.target.value } : v,
                          ),
                        )
                      }
                    />
                    {f.quote && (
                      <details className="fact-quote">
                        <summary>原材料依据</summary>
                        <p>{f.quote}</p>
                      </details>
                    )}
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={f.confirmed}
                        onChange={(e) =>
                          editFacts(
                            p.facts.map((v, i) =>
                              i === index
                                ? { ...v, confirmed: e.target.checked }
                                : v,
                            ),
                          )
                        }
                      />{" "}
                      我能确认这一条说明
                    </label>
                  </div>
                ))}
              </div>
              {p.facts.length > 0 && (
                <Button
                  secondary
                  disabled={busy || dirty}
                  onClick={() =>
                    run(async () => {
                      setP(
                        await api("/projects/" + id + "/confirm", "POST", {
                          version: p.version,
                          facts: p.facts,
                        }),
                      );
                      sessionStorage.removeItem(factDraftKey);
                      setFactsDirty(false);
                    })
                  }
                >
                  {p.factsConfirmed
                    ? "已核对 · 可重新保存核对"
                    : "保存核对结果"}
                </Button>
              )}
              {factsDirty && (
                <button
                  className="text-link discard-facts"
                  disabled={busy || dirty}
                  onClick={() =>
                    run(async () => {
                      const value = await api<Project>("/projects/" + id);
                      setP(value);
                      setFactsDirty(false);
                      sessionStorage.removeItem(factDraftKey);
                      setDraftNotice("已恢复已保存的核对结果");
                    })
                  }
                >
                  放弃本次核对修改
                </button>
              )}
            </>
          )}
        </div>
        <aside className="training-aside">
          <div className="training-readiness">
            <div className="training-heading"><span><MessageSquare size={20} /></span><div><small>核对后，进入完整深挖</small><h2>本次训练</h2></div></div>
            <ul className="readiness-list">
              <li>
                {id === "new" ? <Clock size={15} /> : <Check size={15} />}
                {id === "new"
                  ? "材料待保存"
                  : dirty
                    ? "材料有未保存修改"
                    : "材料已保存"}
              </li>
              <li>
                {p.factsConfirmed && !dirty ? (
                  <Check size={15} />
                ) : (
                  <Clock size={15} />
                )}
                {p.factsConfirmed && !dirty ? "事实已核对" : "事实待核对"}
              </li>
              <li>
                <CreditCard size={15} />
                {balance.unlimited
                  ? "永久套餐 · 不限次数"
                  : quota === undefined
                    ? "正在读取权益…"
                    : `剩余 ${quota} 次可用深挖`}
              </li>
            </ul>
            <div className="start-block">
              <TrainingSelect label="练习长度" value={exerciseMode} onChange={setExerciseMode} disabled={busy}
                options={[{ value: "QUICK", label: "快速练习 · 2题" }, { value: "STANDARD", label: "标准深挖 · 5题（复测3题）" }]} />
              <TrainingSelect label="追问侧重" value={difficulty} onChange={setDifficulty} disabled={busy}
                options={[{ value: "BASIC", label: "实习基础与职责" }, { value: "IMPLEMENTATION", label: "实现细节" }, { value: "TRADEOFF", label: "故障与方案取舍" }]} />
              {(id === "new" || dirty || factsDirty || !p.factsConfirmed) && <p className="start-prerequisite">
                <ShieldCheck size={15} />{id === "new" ? "先保存项目材料，再核对事实。" : dirty ? "保存材料修改后，重新核对项目事实。" : "完成事实核对并保存，即可开始深挖。"}
              </p>}
              <Button
                disabled={busy || dirty || !p.factsConfirmed || id === "new"}
                onClick={() => start()}
              >
                {starting ? (
                  <>
                    <LoaderCircle className="spin" size={16} /> 正在开始…
                  </>
                ) : (
                  <>
                    开始项目深挖 <ArrowRight size={16} />
                  </>
                )}
              </Button>
              {startError && <p className="action-error">{startError}</p>}
              <small>
                {balance.unlimited
                  ? `永久权益 · ${exerciseMode === "QUICK" ? 2 : 5} 个回答`
                  : `消耗 1 次训练权益 · ${exerciseMode === "QUICK" ? 2 : 5} 个回答`}
              </small>
              {quota === 0 && !balance.unlimited && (
                <p className="quota-warning">
                  暂无可用深挖次数。已有训练可继续，关联复测不需要再买一包。
                </p>
              )}
              <a
                href="#/shop"
                onClick={(e) => {
                  e.preventDefault();
                  purchaseFrom(id === "new" ? undefined : id);
                }}
              >
                查看训练包与剩余次数
              </a>
            </div>
            {step === "materials" && id !== "new" && (
              <Button
                secondary
                disabled={busy || dirty}
                onClick={() => setStep("facts")}
              >
                核对项目事实
                <ArrowRight size={15} />
              </Button>
            )}
          </div>
          {ongoing.map((t) => (
            <a
              className="resume-row editor-resume"
              href={"#/trainings/" + t.id}
              key={t.id}
            >
              <MessageSquare size={18} />
              <div>
                <strong>
                  继续{t.kind === "RETEST" ? "专项复测" : "已有深挖"}
                </strong>
                <small>
                  已保存 {t.answeredCount}/{t.maxTurns} 个回答 · 不重复扣次
                </small>
              </div>
              <ArrowRight size={15} />
            </a>
          ))}
          {history
            .filter((t) => t.kind === "DEEP" && t.status === "COMPLETED")
            .map((t) => (
              <div className="retest-entry" key={t.id}>
                <RefreshCw size={22} />
                <h3>补充后，再测一次</h3>
                <p>{t.retestTopics?.join(" · ")}</p>
                {t.retestEntry?.returned &&
                  t.retestEntry.state === "AVAILABLE" && (
                    <small>上次故障复测次数已返还，可以重新开始。</small>
                  )}
                <Button
                  disabled={
                    busy ||
                    t.retestEntry?.state === "UNAVAILABLE" ||
                    (t.retestEntry?.state === "AVAILABLE" &&
                      (dirty || !p.factsConfirmed))
                  }
                  onClick={() => {
                    const entry = t.retestEntry;
                    if (entry?.trainingId)
                      go(
                        (entry.state === "COMPLETED"
                          ? "/report/"
                          : "/trainings/") + entry.trainingId,
                      );
                    else start(t.id);
                  }}
                >
                  {t.retestEntry?.state === "COMPLETED"
                    ? "查看复测结果"
                    : t.retestEntry?.state === "CONTINUE"
                      ? "继续复测"
                      : t.retestEntry?.state === "UNAVAILABLE"
                        ? "此轮复测权益不可用"
                        : "开始关联复测"}
                </Button>
                <a href={"#/report/" + t.id}>查看上次报告</a>
              </div>
            ))}
        </aside>
      </div>
    </section>
  );
}

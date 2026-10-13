import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  FolderOpen,
  MessageSquare,
  Plus,
  Search,
  RefreshCw,
  CreditCard,
} from "lucide-react";
import { api, go } from "./api";
import type { Project, Training, Shop } from "./types";
import { trainingQuota } from "./quota";

export function purchaseFrom(projectId?: string) {
  if (projectId) sessionStorage.setItem("purchase:project", projectId);
  else sessionStorage.removeItem("purchase:project");
  go("/shop");
}

export function purchaseProject(orderId?: string) {
  const id =
    sessionStorage.getItem(
      orderId ? "purchase:order:" + orderId : "purchase:project",
    ) || "";
  return /^[a-f0-9-]{36}$/.test(id) ? id : "";
}

export function Workspace({
  run,
  busy,
}: {
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [data, setData] = useState<{
    projects: Project[];
    trainings: Training[];
    shop: Shop;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  useEffect(() => {
    run(async () => {
      const [projects, trainings, shop] = await Promise.all([
        api<Project[]>("/projects"),
        api<Training[]>("/trainings"),
        api<Shop>("/shop"),
      ]);
      setData({ projects, trainings, shop });
    });
  }, [run]);
  const active =
    data?.trainings.filter(
      (t) => !["COMPLETED", "REFUNDED"].includes(t.status),
    ) || [];
  const completed =
    data?.trainings.filter((t) => t.status === "COMPLETED") || [];
  const balance = trainingQuota(data?.shop);
  const quota = balance.unlimited ? "不限次数" : balance.deepAvailable;
  const projects =
    data?.projects.filter(
      (p) =>
        (p.name + " " + p.stack).toLowerCase().includes(query.toLowerCase()) &&
        (filter === "全部" ||
          (filter === "待核对" ? !p.factsConfirmed : p.factsConfirmed)),
    ) || [];
  return (
    <section className="page workspace-page">
      <div className="page-head">
        <div>
          <div className="section-kicker">项目追问官 / 工作台</div>
          <h1>我的项目</h1>
          <p>从材料到复测，接着上次的进度往前走。</p>
        </div>
        <button className="button" onClick={() => go("/projects/new")}>
          <Plus size={17} />
          新建项目
        </button>
      </div>
      <div className="workspace-stats" aria-label="练习概览">
        {[
          ["项目档案", data?.projects.length],
          ["待继续训练", active.length],
          ["已完成报告", completed.length],
          ["可用深挖", quota],
        ].map(([name, value]) => (
          <div key={name}>
            <span>{name}</span>
            <strong>{data ? value : "—"}</strong>
          </div>
        ))}
      </div>
      {!data ? (
        <div className="empty" role="status">
          正在读取工作台…
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="resume-band">
              <div className="section-heading">
                <h2>继续练习</h2>
                <a href="#/history">
                  全部记录 <ArrowRight size={14} />
                </a>
              </div>
              {active.slice(0, 3).map((t) => (
                <a
                  className="resume-row"
                  href={"#/trainings/" + t.id}
                  key={t.id}
                >
                  {t.kind === "RETEST" ? (
                    <RefreshCw size={20} />
                  ) : (
                    <MessageSquare size={20} />
                  )}
                  <div>
                    <strong>{t.project.name}</strong>
                    <small>
                      {t.kind === "RETEST" ? "专项复测" : "项目深挖"} · 已保存{" "}
                      {t.turns.filter((v) => v.answer).length}/{t.maxTurns}{" "}
                      个回答
                    </small>
                  </div>
                  <span className="badge">
                    {t.status === "FAILED" ? "需要恢复" : "进行中"}
                  </span>
                  <ArrowRight size={16} />
                </a>
              ))}
            </section>
          )}
          <div className="workspace-content">
            <section className="project-index">
              <div className="index-toolbar">
                <div className="segmented" aria-label="项目状态">
                  {["全部", "待核对", "已核对"].map((v) => (
                    <button
                      key={v}
                      aria-pressed={v === filter}
                      onClick={() => setFilter(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <label className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="搜索项目"
                    placeholder="搜索名称、技术栈"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {projects.length === 0 ? (
                <div className="empty">
                  <FolderOpen size={30} />
                  <h2>
                    {data.projects.length
                      ? "没有匹配的项目"
                      : "准备你的第一个项目"}
                  </h2>
                  <p>
                    {data.projects.length
                      ? "试试其他关键词或状态。"
                      : "从一段项目经历开始，也可以载入合成示例。"}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() =>
                      data.projects.length
                        ? (setQuery(""), setFilter("全部"))
                        : go("/projects/new")
                    }
                  >
                    {data.projects.length ? "清除筛选" : "创建第一个项目"}
                    <Plus size={16} />
                  </button>
                </div>
              ) : (
                projects.map((p) => {
                  const latest = data.trainings.find(
                    (t) => t.project.id === p.id && t.status !== "REFUNDED",
                  );
                  const ongoing = data.trainings.find(
                    (t) =>
                      t.project.id === p.id &&
                      !["COMPLETED", "REFUNDED"].includes(t.status),
                  );
                  const next = ongoing
                    ? "/trainings/" + ongoing.id
                    : "/projects/" + p.id;
                  return (
                    <article className="project-row" key={p.id}>
                      <span className="project-mark">
                        <FolderOpen size={21} />
                      </span>
                      <div className="project-info">
                        <a href={"#/projects/" + p.id}>
                          <h2>{p.name}</h2>
                        </a>
                        <p>{p.background || "尚未补充项目背景"}</p>
                        <div className="tags">
                          {p.stack
                            .split(/[,，/]/)
                            .filter(Boolean)
                            .slice(0, 4)
                            .map((tag, i) => (
                              <span key={i}>{tag.trim()}</span>
                            ))}
                        </div>
                        <small>
                          {latest
                            ? (latest.kind === "RETEST"
                                ? "最近复测"
                                : "最近深挖") +
                              " · " +
                              new Date(latest.createdAt).toLocaleDateString(
                                "zh-CN",
                              )
                            : "尚未开始训练"}
                        </small>
                      </div>
                      <div className="project-actions">
                        <span
                          className={
                            "badge " + (p.factsConfirmed ? "confirmed" : "")
                          }
                        >
                          {p.factsConfirmed ? <Check size={12} /> : null}
                          {p.factsConfirmed ? "事实已核对" : "待核对事实"}
                        </span>
                        <a className="text-link" href={"#" + next}>
                          {ongoing
                            ? "继续训练"
                            : p.factsConfirmed
                              ? "进入项目"
                              : "整理材料"}
                          <ArrowRight size={15} />
                        </a>
                        {latest?.status === "COMPLETED" && (
                          <a
                            href={"#/report/" + latest.id}
                            className="minor-link"
                          >
                            查看最近报告
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </section>
            <aside className="workspace-aside">
              <CreditCard size={21} />
              <h2>训练权益</h2>
              <div className="quota-number">
                {quota}
                <small>次深挖可用</small>
              </div>
              <p>新套餐的深挖与复测共用次数。继续已有训练不重复消耗次数。</p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => purchaseFrom()}
              >
                训练包与订单
                <ArrowRight size={15} />
              </button>
              <hr />
              <h3>下一步</h3>
              <ol className="workflow-list">
                <li>保存项目材料</li>
                <li>核对原文与事实边界</li>
                <li>回答连续项目追问</li>
                <li>补充任务后关联复测</li>
              </ol>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

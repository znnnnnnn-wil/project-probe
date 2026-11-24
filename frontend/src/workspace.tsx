import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  FolderOpen,
  MessageSquare,
  Plus,
  Search,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api, go } from "./api";
import type { ProjectSummary, TrainingSummary } from "./types";

export function Workspace({
  run,
}: {
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [data, setData] = useState<{
    projects: ProjectSummary[];
    trainings: TrainingSummary[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [notice, setNotice] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    run(async () => {
      const [projects, overview] = await Promise.all([
        api<ProjectSummary[]>(
          "/projects?summary=true",
          "GET",
          undefined,
          controller.signal,
        ),
        api<{
          items: TrainingSummary[];
        }>("/training-overview", "GET", undefined, controller.signal),
      ]);
      if (!controller.signal.aborted)
        setData({
          projects,
          trainings: overview.items,
        });
    });
    return () => controller.abort();
  }, [run]);
  const active =
    data?.trainings.filter(
      (t) => !["COMPLETED", "REFUNDED"].includes(t.status),
    ) || [];
  const projects =
    data?.projects.filter(
      (p) => (p.name + " " + p.stack).toLowerCase().includes(query.trim().toLowerCase()),
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
      {notice && <p role="status">{notice}</p>}
      {deleting && <DeleteProjectDialog project={deleting} onCancel={() => setDeleting(null)} onDeleted={() => {
        const projectId = deleting.id!;
        for (const prefix of ["project-draft:", "project:expand:", "practice-draft:", "practice-draft-turn:", "practice-draft-exchange:", "practice-review:"])
          sessionStorage.removeItem(prefix + projectId);
        const trainingIds = data!.trainings.filter(t => t.project.id === projectId).map(t => t.id);
        for (const key of Object.keys(sessionStorage)) {
          if (trainingIds.some(id => key.startsWith("draft:" + id + ":") || key.startsWith("plan-draft:" + id + ":")))
            sessionStorage.removeItem(key);
        }
        setData(current => current && ({
          projects: current.projects.filter(p => p.id !== projectId),
          trainings: current.trainings.filter(t => t.project.id !== projectId),
        }));
        setNotice(`已删除“${deleting.name}”及其训练内容。`);
        setDeleting(null);
        search.current?.focus();
      }} />}
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
                      {t.answeredCount}/{t.maxTurns} 个回答
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
            <section className="project-index">
              <div className="index-toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    ref={search}
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
                        ? setQuery("")
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
                  const projectPath = "#/projects/" + p.id;
                  return (
                    <article className="project-row" key={p.id}>
                      <span className="project-mark">
                        <FolderOpen size={21} />
                      </span>
                      <div className="project-info">
                        <h2>{p.name}</h2>
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
                      </div>
                      <div className="project-actions">
                        <a className="button secondary" href={projectPath + "?interview=1"}>
                          进入面试室
                          <ArrowRight size={15} />
                        </a>
                        <a className="minor-link" href={projectPath}>编辑材料</a>
                        {latest?.status === "COMPLETED" && (
                          <a
                            href={"#/report/" + latest.id}
                            className="minor-link"
                          >
                            查看最近报告
                          </a>
                        )}
                        <button type="button" className="project-delete-link" aria-haspopup="dialog" onClick={() => {
                          setNotice("");
                          setDeleting(p);
                        }}>
                          <Trash2 size={14} aria-hidden="true" />删除项目
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </section>
        </>
      )}
    </section>
  );
}

function DeleteProjectDialog({ project, onCancel, onDeleted }: {
  project: ProjectSummary;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    cancel.current!.focus();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="project-delete-dialog" aria-labelledby="project-delete-title"
    aria-describedby="project-delete-description" onCancel={event => {
      event.preventDefault();
      if (!busy) onCancel();
    }}>
    <form aria-busy={busy} onSubmit={async event => {
      event.preventDefault();
      if (busy || !password || confirmation !== project.name) return;
      setBusy(true);
      setError("");
      try {
        await api("/projects/" + encodeURIComponent(project.id!), "DELETE", { password, confirmation });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "删除失败，请稍后重试。");
        setBusy(false);
        return;
      }
      dialog.current!.close();
      onDeleted();
    }}>
      <span className="project-delete-icon"><Trash2 size={24} aria-hidden="true" /></span>
      <h2 id="project-delete-title">删除项目</h2>
      <p className="project-delete-name">{project.name}</p>
      <p id="project-delete-description">项目材料、修订、全部面试问答、报告和草稿将一并永久删除，无法恢复。其他项目不受影响。</p>
      <label htmlFor="project-delete-password">当前密码</label>
      <input id="project-delete-password" type="password" autoComplete="current-password" required
        disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
      <label htmlFor="project-delete-confirmation">输入完整项目名称以确认</label>
      <input id="project-delete-confirmation" autoComplete="off" required disabled={busy}
        value={confirmation} onChange={event => setConfirmation(event.target.value)} />
      {error && <p className="project-delete-error" role="alert">{error}</p>}
      <div className="project-delete-actions">
        <button ref={cancel} type="button" className="button secondary" disabled={busy} onClick={onCancel}>取消</button>
        <button type="submit" className="button project-delete-confirm"
          disabled={busy || !password || confirmation !== project.name}>{busy ? "正在删除…" : "永久删除项目"}</button>
      </div>
    </form>
  </dialog>;
}

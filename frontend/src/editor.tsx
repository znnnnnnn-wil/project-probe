import React, { useState, useEffect } from "react";
import {
  ArrowRight,
  MessageSquare,
  RefreshCw,
  Check,
  ShieldCheck,
} from "lucide-react";
import { api, go, emptyProject } from "./api";
import type { Project, Training, TrainingSummary } from "./types";
import { ResumeImport } from "./resume-import";
import { Button, Loading, PageHead } from "./ui";
import type { Actions } from "./ui";
import { useMounted } from "./use-read-scope";
import "./editor.css";
import { ProjectFields, mergeLegacyMaterials } from "./project-fields";

export function Editor({ id, run, busy }: Actions & { id: string }) {
  const mounted = useMounted();
  const [importBusy, setImportBusy] = useState(false);
  busy = busy || importBusy;
  const [p, setP] = useState<Project>({ ...emptyProject });
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<TrainingSummary[]>([]);
  const [startKey] = useState(crypto.randomUUID());
  const [draftNotice, setDraftNotice] = useState("");
  const [legacyNotice, setLegacyNotice] = useState(false);
  const resumeTooLong = p.resume.length > 12000;
  const draftKey = "project-draft:" + id;
  const restore = (project: Project) => {
    let source = project;
    let restored = false;
    setDraftNotice("");
    const raw = sessionStorage.getItem(draftKey);
    if (raw)
      try {
        const draft = JSON.parse(raw) as Project;
        if (
          draft.version === project.version &&
          typeof draft.name === "string" &&
          typeof draft.background === "string"
        ) {
          // Cleared legacy fields in a migrated draft must override the server.
          source = { ...project, ...draft };
          restored = true;
          setDraftNotice("已恢复此标签页未保存的材料");
        } else {
          setDraftNotice("材料已在其他页面更新，旧草稿未覆盖新版本");
        }
      } catch {
        sessionStorage.removeItem(draftKey);
      }
    const merged = mergeLegacyMaterials(source);
    setP(merged.project);
    setDirty(restored || merged.migrated);
    setLegacyNotice(merged.migrated || mergeLegacyMaterials(project).migrated);
  };
  useEffect(() => {
    const controller = new AbortController();
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
    return () => controller.abort();
  }, [id, run]);
  useEffect(() => {
    if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(p));
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [p, dirty, draftKey]);
  const save = () => {
    if (busy || resumeTooLong) return;
    return run(async () => {
      const result = await api<Project>("/projects/" + id, "PUT", p);
      setP(result);
      setDirty(false);
      setLegacyNotice(false);
      sessionStorage.removeItem(draftKey);
      setDraftNotice("材料已保存");
    });
  };
  const startRetest = (parentId: string) =>
    run(async () => {
      const t = await api<Training>("/trainings", "POST", {
        projectId: id,
        parentId,
        requestKey: startKey.slice(0, 16) + "-retest-" + parentId,
      });
      if (mounted.current)
        go((t.status === "COMPLETED" ? "/report/" : "/trainings/") + t.id);
    });
  if (!loaded) return <Loading />;
  const ongoing = history.filter(
    (t) => !["COMPLETED", "REFUNDED"].includes(t.status),
  );
  const completedDeep = history.filter(
    (t) => t.kind === "DEEP" && t.status === "COMPLETED",
  );
  return (
    <section className="page editor-page">
      <PageHead
        eyebrow="项目档案"
        title={p.name}
        text={"Java 后端项目面试 · 材料版本 " + p.version}
        action={
          <Button secondary onClick={() => go("/projects")}>
            返回项目列表
          </Button>
        }
      />
      {draftNotice && (
        <p className="save-notice" role="status">
          {draftNotice}
        </p>
      )}
      {legacyNotice && (
        <p className="save-notice">
          旧版材料已合并到“项目经历”，可修改或删除；保存后以当前五字段为准。尚未修改服务端，历史快照不变。
        </p>
      )}
      <div className="editor-layout">
        <div id="project-materials" className="materials-panel">
          <div className="panel-heading">
            <h2>项目材料</h2>
          </div>
          <div className="material-guide">
            <strong>填好名称，就能开始</strong>
            <p>保存项目名称后即可开始训练。目标岗位、技术栈、项目简介与项目经历可以按需补充。</p>
            <details>
              <summary>项目简介与项目经历怎么写？查看填写参考</summary>
              <p>简介写清项目为谁解决什么问题；经历围绕你亲自参与的部分，写清做了什么、怎么做，以及哪些内容还不确定。</p>
              <blockquote>合成示例：我负责预约创建接口，用数据库唯一约束处理重复预约；登录模块由同学完成；并发正确性还没有验证。</blockquote>
              <p>请按实际经历填写。课程项目、协作任务和未验证的内容都可以如实说明。</p>
            </details>
          </div>
          <p className="material-privacy">
            <ShieldCheck size={15} />
            材料用于 AI
            提取与追问，并保存在服务端。请移除密钥、个人身份信息和无权提供的代码。
          </p>
          <ResumeImport
            disabled={busy}
            onBusy={setImportBusy}
            onSelect={(candidate) => {
              if (
                (p.name.trim() || p.background.trim() || p.resume.trim()) &&
                !window.confirm(
                  "将用选中的简历项目替换当前材料草稿，已保存的服务器记录不会立即修改。是否继续？",
                )
              )
                return;
              const merged = mergeLegacyMaterials({
                ...p,
                ...candidate,
                targetRole: candidate.targetRole || p.targetRole,
                materials: "",
                facts: [],
                factsConfirmed: false,
              });
              setP(merged.project);
              setLegacyNotice((current) => current || merged.migrated);
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
            <ProjectFields
              project={p}
              allowResumeOverflow
              onChange={(field, value) => {
                setP({ ...p, [field]: value });
                setDirty(true);
              }}
            />
            {resumeTooLong && (
              <p className="action-error" role="alert">
                项目经历超过 12000 字（当前 {p.resume.length} 字），全文已保留在草稿中。请自行备份并整理至 12000 字以内后保存。
              </p>
            )}
            <div className="form-bottom">
              <span>
                {dirty ? "有尚未保存的修改" : "材料已保存"}
              </span>
              <Button type="submit" disabled={busy || resumeTooLong}>
                保存项目材料 <Check size={16} />
              </Button>
            </div>
          </form>
        </div>
        {(ongoing.length > 0 || completedDeep.length > 0) && <aside className="training-aside">
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
                  已保存 {t.answeredCount}/{t.maxTurns} 个回答
                </small>
              </div>
              <ArrowRight size={15} />
            </a>
          ))}
          {completedDeep.map((t) => (
              <div className="retest-entry" key={t.id}>
                <RefreshCw size={22} />
                <h3>补充后，再测一次</h3>
                <p>{t.retestTopics?.join(" · ")}</p>
                <Button
                  disabled={
                    busy ||
                    t.retestEntry?.state === "UNAVAILABLE" ||
                    (t.retestEntry?.state === "AVAILABLE" && dirty)
                  }
                  onClick={() => {
                    const entry = t.retestEntry;
                    if (entry?.trainingId)
                      go(
                        (entry.state === "COMPLETED"
                          ? "/report/"
                          : "/trainings/") + entry.trainingId,
                      );
                    else startRetest(t.id);
                  }}
                >
                  {t.retestEntry?.state === "COMPLETED"
                    ? "查看复测结果"
                    : t.retestEntry?.state === "CONTINUE"
                      ? "继续复测"
                      : t.retestEntry?.state === "UNAVAILABLE"
                        ? "此轮暂时无法复测"
                        : "开始关联复测"}
                </Button>
                <a href={"#/report/" + t.id}>查看上次报告</a>
              </div>
            ))}
        </aside>}
      </div>
    </section>
  );
}

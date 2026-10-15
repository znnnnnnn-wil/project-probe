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
  const [step, setStep] = useState<"materials" | "facts">("materials");
  const [shop, setShop] = useState<Shop | null>(null);
  const [draftNotice, setDraftNotice] = useState("");
  const [factsDirty, setFactsDirty] = useState(false);
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
          requestKey: parentId ? startKey + "-retest-" + parentId : startKey,
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
  return null;
}

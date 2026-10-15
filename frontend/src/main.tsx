import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  FolderOpen,
  MessageSquare,
  FileText,
  RefreshCw,
  Check,
  ChevronRight,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  Clock,
  Layers,
  LoaderCircle,
  Sparkles,
  Target,
  CreditCard,
  Download,
  Printer,
  ChevronDown,
} from "lucide-react";
import { api, ApiError, go, emptyProject, demoProject } from "./api";
import type { Project, Training, Shop, Fact, Report, Order } from "./types";
import { paymentLabel, submitPaymentForm, orderLabel } from "./payment";
import "./style.css";
import { Workspace, purchaseFrom, purchaseProject } from "./workspace";
import { downloadReport } from "./report-export";
import { trainingQuota } from "./quota";
import { ResumeImport } from "./resume-import";
import { VoiceInput } from "./voice-input";

import { Loading as SharedLoading, Empty as SharedEmpty, PageBoundary as SharedPageBoundary } from "./ui";
const NewHome = lazy(() =>
  import("./home").then((module) => ({ default: module.Home })),
);
const NewLogin = lazy(() =>
  import("./home").then((module) => ({ default: module.Login })),
);
const NewEditor = lazy(() =>
  import("./editor").then((module) => ({ default: module.Editor })),
);
const NewHistory = lazy(() =>
  import("./history").then((module) => ({ default: module.History })),
);
const NewInterview = lazy(() =>
  import("./interview").then((module) => ({ default: module.Interview })),
);
const NewReportPage = lazy(() =>
  import("./report").then((module) => ({ default: module.ReportPage })),
);
const NewShopPage = lazy(() =>
  import("./shop").then((module) => ({ default: module.ShopPage })),
);
const NewPaymentReturn = lazy(() =>
  import("./shop").then((module) => ({ default: module.PaymentReturn })),
);

const sourceLabel: Record<string, string> = {
  USER_PROVIDED: "材料提供",
  INTERVIEW_SUPPLEMENT: "面试补充",
  AI_INFERENCE: "AI 推断",
  NEEDS_CONFIRMATION: "待确认",
};
const statusLabel: Record<string, string> = {
  ACTIVE: "进行中",
  PENDING: "待生成",
  GENERATING: "生成中",
  FAILED: "可重试",
  COMPLETED: "已完成",
  REFUNDED: "已返还",
};
function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={"button " + (secondary ? "secondary" : "")}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function App() {
  const [path, setPath] = useState(
    location.hash.slice(1) ||
      (location.pathname === "/payment-return" ? "/payment-return" : "/"),
  );
  const [user, setUser] = useState<{ id: string; username: string } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<{
    modelMode: string;
    modelName?: string;
    paymentMode: string;
    paymentConfigured: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [pendingRequests, setPendingRequests] = useState(0);
  const busy = pendingRequests > 0;
  const [menu, setMenu] = useState(false);
  const navigationVersion = useRef(0);
  useEffect(() => {
    const change = () => {
      ++navigationVersion.current;
      setPath(
        location.hash.slice(1) ||
          (location.pathname === "/payment-return" ? "/payment-return" : "/"),
      );
      setError("");
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    api<typeof config>("/config")
      .then(setConfig)
      .catch(() => setError("暂时无法连接服务，请确认后端已启动后刷新。"));
    api<typeof user>("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true));
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const run = useCallback(async (fn: () => Promise<void>) => {
    const version = navigationVersion.current;
    setPendingRequests((count) => count + 1);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (
        version !== navigationVersion.current ||
        (e instanceof DOMException && e.name === "AbortError")
      )
        return;
      setError(e instanceof Error ? e.message : "操作失败，请重试");
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        go("/login");
      }
    } finally {
      setPendingRequests((count) => count - 1);
    }
  }, []);
  const props = { run, busy };
  const nav = path.split("/")[1];
  useEffect(() => {
    if (
      ready &&
      !user &&
      path !== "/" &&
      path !== "/login" &&
      /^\/(projects|trainings|report|shop|history|payment-return)(\/|$)/.test(
        path,
      )
    ) {
      sessionStorage.setItem("auth:return", path);
    }
  }, [path, ready, user]);
  return (
    <>
      <header>
        <a className="brand" href="#/">
          <span className="brand-icon">
            <MessageSquare size={19} />
          </span>
          项目追问官<span className="brand-dot">·</span>
        </a>
        <button
          className="menu-toggle"
          aria-label="切换导航"
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
        <nav className={menu ? "open" : ""}>
          <a
            className={nav === "projects" || (user && !nav) ? "selected" : ""}
            href="#/projects"
          >
            我的项目
          </a>
          <a className={nav === "history" ? "selected" : ""} href="#/history">
            训练记录
          </a>
          <a className={nav === "shop" ? "selected" : ""} href="#/shop">
            训练包与订单
          </a>
        </nav>
        <div className="account">
          {user ? (
            <>
              <span>{user.username}</span>
              <button
                aria-label="退出登录"
                onClick={() =>
                  run(async () => {
                    await api("/auth/logout", "POST");
                    sessionStorage.clear();
                    setUser(null);
                    go("/");
                  })
                }
              >
                <LogOut size={16} />
              </button>
            </>
          ) : (
            <a href="#/login">
              登录 / 注册 <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      </header>
      <div className="mode-strip">
        {config?.modelMode === "demo" && <span>规则演示 · 非 AI 技术评估</span>}
        <span className="strip-right">
          {config?.paymentMode === "mock"
            ? "开发模拟支付 · 不产生真实扣款"
            : config?.paymentMode === "production"
              ? "正式支付宝支付 · 会产生真实扣款"
              : "官方沙箱 · 非真实交易"}
        </span>
      </div>
      {error && (
        <div role="alert" className="error">
          <span>{error}</span>
          <button onClick={() => window.location.reload()}>重新加载</button>
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {busy && (
        <div className="working" role="status">
          <LoaderCircle className="spin" size={16} /> 正在处理，请稍候…
        </div>
      )}
      <main>
        <SharedPageBoundary key={path}>
          <Suspense fallback={<SharedLoading />}>
            {!ready ? (
              <SharedLoading />
            ) : path === "/" && !user ? (
              <NewHome
                onStart={() => {
                  sessionStorage.setItem("auth:return", "/projects/new");
                  go("/login");
                }}
              />
            ) : !user || path === "/login" ? (
              <NewLogin
                {...props}
                onLogin={(u) => {
                  setUser(u);
                  const next =
                    sessionStorage.getItem("auth:return") || "/projects";
                  sessionStorage.removeItem("auth:return");
                  go(
                    location.pathname === "/payment-return"
                      ? "/payment-return"
                      : /^\/(projects|trainings|report|shop|history)(\/|$)/.test(
                            next,
                          )
                        ? next
                        : "/projects",
                  );
                }}
              />
            ) : path === "/" || nav === "projects" ? (
              path === "/" || path === "/projects" ? (
                <Workspace {...props} />
              ) : (
                <NewEditor key={path} id={path.split("/")[2]} {...props} />
              )
            ) : nav === "trainings" ? (
              <NewInterview key={path} id={path.split("/")[2]} {...props} />
            ) : nav === "report" ? (
              <NewReportPage key={path} id={path.split("/")[2]} {...props} />
            ) : nav === "shop" ? (
              <NewShopPage {...props} />
            ) : nav === "payment-return" ? (
              <NewPaymentReturn
                {...props}
                configured={config?.paymentConfigured || false}
                mode={config?.paymentMode || ""}
              />
            ) : nav === "history" ? (
              <NewHistory {...props} />
            ) : (
              <SharedEmpty
                title="页面不存在"
                text="返回项目列表继续练习。"
                action={() => go("/projects")}
              />
            )}
          </Suspense>
        </SharedPageBoundary>
      </main>
      <footer>
        <span>项目追问官</span>
        <span>每一次追问，都离讲明白更近一步。</span>
        <small>练习反馈仅供参考，不承诺面试或录用结果。</small>
      </footer>
    </>
  );
}
type Actions = {
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
};
function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" />
      <p>正在读取记录…</p>
    </div>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: () => void;
}) {
  return (
    <div className="empty">
      <FolderOpen size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <Button onClick={action}>
          开始准备 <ArrowRight size={16} />
        </Button>
      )}
    </div>
  );
}


function PageHead({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="section-kicker">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
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








createRoot(document.getElementById("root")!).render(<App />);

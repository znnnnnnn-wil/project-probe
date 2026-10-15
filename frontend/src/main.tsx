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






function ShopPage({ run, busy }: Actions) {
  const [s, setS] = useState<Shop | null>(null);
  const [key, setKey] = useState(crypto.randomUUID());
  const [createdId, setCreatedId] = useState("");
  const [originProject, setOriginProject] = useState(purchaseProject());
  const load = useCallback(async () => setS(await api("/shop")), []);
  useEffect(() => {
    run(load);
  }, [run, load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void load().catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (createdId)
      document
        .getElementById("order-" + createdId)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [createdId, s?.orders.length]);
  if (!s) return <Loading />;
  const pay = (id: string) =>
    run(async () => {
      if (s.mode === "mock") {
        await api("/orders/" + id + "/mock-pay", "POST");
        await load();
      } else {
        const result = await api<{ formHtml: string }>(
          "/orders/" + id + "/checkout",
          "POST",
        );
        submitPaymentForm(result.formHtml, s.mode);
      }
    });
  const operate = (
    order: Order,
    action: "close" | "cash-refund" | "refund-query",
  ) => {
    if (
      action !== "refund-query" &&
      !window.confirm(
        action === "close"
          ? "确认关闭这笔未付款订单？服务端会先核对付款状态，关闭后不能继续支付。"
          : `确认申请 ¥${(order.amount_cents / 100).toFixed(2)} 全额退款？仅完全未使用的训练包可申请，退款期间权益暂停。`,
      )
    )
      return;
    run(async () => {
      try {
        await api("/orders/" + order.id + "/" + action, "POST");
      } finally {
        await load();
      }
    });
  };
  return (
    <section className="page shop-page">
      <PageHead
        eyebrow="支付宝 AI 网页应用收款"
        title="训练包与订单"
        text="次数套餐与永久套餐，无自动续费。普通中断可继续原训练；系统生成失败可恢复或返还本次训练次数。"
      />
      {originProject && (
        <div className="purchase-context">
          <FolderOpen size={18} />
          <div>
            <strong>为当前项目准备训练权益</strong>
            <small>付款确认后可返回项目开始练习；不会自动扣除训练次数。</small>
          </div>
          <Button secondary onClick={() => go("/projects/" + originProject)}>
            返回原项目
            <ArrowRight size={15} />
          </Button>
          <button
            className="icon-button"
            aria-label="清除购买来源"
            title="清除购买来源"
            onClick={() => {
              sessionStorage.removeItem("purchase:project");
              setOriginProject("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="shop-layout">
        <div className="product-list">
          {(
            s.products || [
              {
                ...s.product,
                code: "TEN_TRAININGS",
                trainingLimit: 10,
                lifetime: false,
              },
            ]
          ).map((product) => (
            <article className="package-card" key={product.code}>
              <span className="badge">{paymentLabel[s.mode]}商品</span>
              <h2>{product.name}</h2>
              <div className="price">
                <small>¥</small>
                {(product.amountCents / 100).toLocaleString("zh-CN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span> / 包</span>
              </div>
              <p>
                {s.mode === "production"
                  ? "正式商品价格，以创建订单时金额为准"
                  : "演示定价，不代表正式售价"}
              </p>
              <ul>
                <li>
                  <Check size={17} />
                  {product.lifetime
                    ? "永久不限训练次数"
                    : "深挖与复测合计 10 次"}
                </li>
                <li>
                  <Check size={17} />
                  {product.lifetime
                    ? "不限深挖与关联复测次数"
                    : "每开启一轮训练扣 1 次"}
                </li>
                <li>
                  <Check size={17} />
                  原回答、材料依据与补充任务
                </li>
                <li>
                  <Check size={17} />
                  已提交记录持久保存与恢复
                </li>
              </ul>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (
                      product.lifetime &&
                      !window.confirm(
                        `确认创建永久套餐订单？金额为 ¥${(product.amountCents / 100).toLocaleString("zh-CN")}；${s.mode === "production" ? "付款将产生真实扣款。" : "当前为测试环境，不使用真实资金。"}`,
                      )
                    )
                      return;
                    const order = await api<Order>("/orders", "POST", {
                      requestKey: key,
                      productCode: product.code,
                    });
                    if (originProject)
                      sessionStorage.setItem(
                        "purchase:order:" + order.id,
                        originProject,
                      );
                    setKey(crypto.randomUUID());
                    await load();
                    setCreatedId(order.id);
                  })
                }
              >
                {product.lifetime ? "创建永久套餐" : "创建"}
                {s.mode === "mock"
                  ? "模拟"
                  : s.mode === "sandbox"
                    ? "沙箱"
                    : "正式"}
                订单 <ArrowRight size={17} />
              </Button>
              {createdId &&
                s.orders.some(
                  (o) =>
                    o.id === createdId &&
                    (o.product_code || "TEN_TRAININGS") === product.code,
                ) && (
                  <p className="save-notice" role="status">
                    订单已创建，前往右侧订单完成付款。
                  </p>
                )}
              <small>
                {s.mode === "mock"
                  ? "不会调用支付宝，不会产生真实扣款。"
                  : s.configured
                    ? s.mode === "production"
                      ? "通过支付宝正式收款，付款将产生真实扣款。"
                      : "仅使用支付宝官方沙箱，不使用真实资金。"
                    : "支付宝配置未完成，支付暂不可用，不会回退模拟支付。"}
              </small>
              {!s.configured && (
                <div role="status">
                  <p>仍需配置：</p>
                  {s.configurationIssues?.map((v) => (
                    <p key={v}>{v}</p>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        <div>
          <div className="panel balance">
            <h2>我的训练权益</h2>
            <div>
              <p>
                <strong>
                  {trainingQuota(s).unlimited
                    ? "不限次数"
                    : trainingQuota(s).sharedRemaining}
                </strong>
                {trainingQuota(s).unlimited
                  ? "永久训练权益"
                  : "深挖与复测共用次数"}
              </p>
              <p>
                <strong>
                  {trainingQuota(s).legacyDeepRemaining +
                    trainingQuota(s).legacyRetestRemaining}
                </strong>
                历史套餐剩余次数
              </p>
            </div>
            <small>
              复测需先完成本项目深挖，并从报告进入。历史套餐保留原有绑定规则。
            </small>
            <a
              href={
                originProject ? "#/projects/" + originProject : "#/projects"
              }
            >
              {originProject ? "返回原项目开始练习" : "前往我的项目"}{" "}
              <ArrowRight size={15} />
            </a>
          </div>
          <div className="panel orders">
            <div className="panel-heading">
              <h2>订单记录</h2>
              <button
                className="text-link"
                disabled={busy}
                onClick={() => run(load)}
              >
                <RefreshCw size={14} />
                刷新
              </button>
            </div>
            {!s.orders.length ? (
              <p className="mini-empty">暂无订单。创建订单后可查看支付状态。</p>
            ) : (
              s.orders.map((o) => (
                <div
                  className={"order " + (createdId === o.id ? "new-order" : "")}
                  id={"order-" + o.id}
                  key={o.id}
                >
                  <div>
                    <span className="badge">
                      {paymentLabel[o.mode] || "未知环境"}
                      {o.can_operate === false ? " · 历史账号订单" : ""}
                    </span>
                    <h3>
                      {o.product_name || "项目深挖训练包"}{" "}
                      <span>¥{(o.amount_cents / 100).toFixed(2)}</span>
                    </h3>
                    <details className="order-number">
                      <summary>订单编号</summary>
                      <small>{o.id}</small>
                    </details>
                    <p>
                      {new Date(o.created_at).toLocaleString("zh-CN")} ·{" "}
                      {orderLabel(o)}
                    </p>
                    {o.query_error && <small>{o.query_error}</small>}
                    {o.status === "PENDING" && o.expires_at && (
                      <small>
                        付款截止{" "}
                        {new Date(o.expires_at).toLocaleString("zh-CN")}
                      </small>
                    )}
                  </div>
                  {(o.status === "PENDING" || o.status === "EXPIRED") &&
                    o.mode !== "mock" &&
                    o.mode === s.mode &&
                    o.can_operate !== false &&
                    s.configured && (
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            try {
                              await api("/orders/" + o.id + "/sync", "POST");
                            } finally {
                              await load();
                            }
                          })
                        }
                      >
                        查询支付宝状态
                      </button>
                    )}
                  {o.status === "PENDING" &&
                    o.can_pay !== false &&
                    (!o.expires_at || o.expires_at > Date.now()) &&
                    o.mode === s.mode &&
                    o.can_operate !== false && (
                      <Button
                        secondary
                        disabled={busy || (s.mode !== "mock" && !s.configured)}
                        onClick={() => pay(o.id)}
                      >
                        {s.mode === "mock"
                          ? "模拟支付成功"
                          : s.mode === "sandbox"
                            ? "前往官方沙箱"
                            : "前往支付宝付款"}
                      </Button>
                    )}
                  {s.operationsEnabled &&
                    s.configured &&
                    o.mode === s.mode &&
                    o.can_operate !== false && (
                      <div className="order-operations">
                        {["PENDING", "EXPIRED"].includes(o.status) && (
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() => operate(o, "close")}
                          >
                            关闭未付款订单
                          </button>
                        )}
                        {o.status === "PAID" &&
                          s.packages.some(
                            (pack) =>
                              pack.order_id === o.id &&
                              !pack.deep_used &&
                              !pack.retest_used &&
                              !(pack.training_used || 0),
                          ) && (
                            <button
                              className="text-link"
                              disabled={busy}
                              onClick={() => operate(o, "cash-refund")}
                            >
                              申请未使用训练包退款
                            </button>
                          )}
                        {o.status === "REFUNDING" && (
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() => operate(o, "refund-query")}
                          >
                            查询退款状态
                          </button>
                        )}
                      </div>
                    )}
                </div>
              ))
            )}
          </div>
          <div className="delivery-note">
            <ShieldCheck size={18} />
            <div>
              <h3>交付与恢复</h3>
              <p>
                付款由服务端确认后发放次数。离开练习可随时继续，生成失败可重试或返还本次训练次数。次数返还不等于资金退款。
              </p>
              <p>
                {s.mode === "production"
                  ? "付款使用真实资金。未使用训练包的资金退款以订单处理结果为准。"
                  : "当前为测试环境，不使用真实资金，不计作真实付费用户。"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
function PaymentReturn({
  run,
  busy,
  mode,
  configured,
}: Actions & { mode: string; configured: boolean }) {
  const id = new URLSearchParams(location.search).get("probe_order") || "";
  const [order, setOrder] = useState<Order | null>(null);
  const originProject = purchaseProject(id);
  const load = useCallback(async () => {
    const current = await api<Order>("/orders/" + id);
    setOrder(current);
    if (
      (current.status === "PENDING" || current.status === "EXPIRED") &&
      current.mode === mode &&
      current.can_operate !== false &&
      mode !== "mock" &&
      configured
    ) {
      try {
        setOrder(await api<Order>("/orders/" + id + "/sync", "POST"));
      } catch (e) {
        setOrder(await api<Order>("/orders/" + id));
        throw e;
      }
    }
  }, [id, mode, configured]);
  useEffect(() => {
    if (/^[a-f0-9-]{36}$/.test(id)) run(load);
  }, [id, run, load]);
  if (!/^[a-f0-9-]{36}$/.test(id))
    return (
      <Empty
        title="未找到待核对订单"
        text="返回订单页选择订单。跳转参数不能证明付款成功。"
        action={() => go("/shop")}
      />
    );
  return (
    <section className="page">
      <PageHead
        eyebrow="支付结果核对"
        title={order ? orderLabel(order) : "正在读取订单…"}
        text="此页以服务端通知或查询结果为准。返回到本页不代表付款成功，不会依据跳转参数发放次数。"
      />
      <div className="panel">
        {order && (
          <>
            <span className="badge">{paymentLabel[order.mode]}</span>
            <p>订单金额 ¥{(order.amount_cents / 100).toFixed(2)}</p>
            <small>{order.id}</small>
            {order.query_error && <p>{order.query_error}</p>}
            {order.can_operate === false && (
              <p>该订单属于历史支付环境或账号，当前环境不能查询或支付。</p>
            )}
          </>
        )}
        {order?.status === "PAID" && (
          <div className="payment-delivered">
            <Check size={28} />
            <h2>训练包已交付</h2>
            <p>
              {order.lifetime
                ? "永久训练权益已开通。"
                : order.product_code === "TEN_TRAININGS"
                  ? "深挖与复测合计 10 次已到账。"
                  : "1 次深挖 + 1 次关联复测已到账。"}
              现在可以继续准备项目。
            </p>
            <Button
              onClick={() =>
                go(originProject ? "/projects/" + originProject : "/projects")
              }
            >
              {originProject ? "返回原项目开始练习" : "前往我的项目"}
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
        <p>
          <Button secondary disabled={busy} onClick={() => run(load)}>
            重新查询订单状态
          </Button>
        </p>
        <a href="#/shop">返回训练包与订单</a>
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

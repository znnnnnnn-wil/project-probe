import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import {
  ArrowUpRight,
  MessageSquare,
  LogOut,
  Menu,
  X,
  LoaderCircle,
} from "lucide-react";
import { api, ApiError, go } from "./api";
import { Workspace } from "./workspace";
import { Loading, Empty, PageBoundary } from "./ui";

import { createRoot } from "react-dom/client";
import "./style.css";
const Home = lazy(() =>
  import("./home").then((module) => ({ default: module.Home })),
);
const Account = lazy(() => import("./account").then(module => ({ default: module.Account })));
const PrivacyInfo = lazy(() => import("./privacy").then(module => ({ default: module.PrivacyInfo })));
const Login = lazy(() =>
  import("./home").then((module) => ({ default: module.Login })),
);
const Editor = lazy(() =>
  import("./editor").then((module) => ({ default: module.Editor })),
);
const History = lazy(() =>
  import("./history").then((module) => ({ default: module.History })),
);
const Interview = lazy(() =>
  import("./interview").then((module) => ({ default: module.Interview })),
);
const ReportPage = lazy(() =>
  import("./report").then((module) => ({ default: module.ReportPage })),
);
const ShopPage = lazy(() =>
  import("./shop").then((module) => ({ default: module.ShopPage })),
);
const PaymentReturn = lazy(() =>
  import("./shop").then((module) => ({ default: module.PaymentReturn })),
);

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
      setError(e instanceof ApiError && e.requestId ? `${e.message}（请求编号：${e.requestId}）` : e instanceof Error ? e.message : "操作失败，请重试");
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
              <a href="#/account">{user.username} · 账户</a>
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
        <PageBoundary key={path}>
          <Suspense fallback={<Loading />}>
            {!ready ? (
              <Loading />
            ) : nav === "privacy" ? <PrivacyInfo /> : path === "/" && !user ? (
              <Home
                onStart={() => {
                  sessionStorage.setItem("auth:return", "/projects/new");
                  go("/login");
                }}
              />
            ) : !user || path === "/login" ? (
              <Login
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
            ) : nav === "account" ? <Account {...props} /> : path === "/" || nav === "projects" ? (
              path === "/" || path === "/projects" ? (
                <Workspace {...props} />
              ) : (
                <Editor key={path} id={path.split("/")[2]} {...props} />
              )
            ) : nav === "trainings" ? (
              <Interview key={path} id={path.split("/")[2]} {...props} />
            ) : nav === "report" ? (
              <ReportPage key={path} id={path.split("/")[2]} {...props} />
            ) : nav === "shop" ? (
              <ShopPage {...props} />
            ) : nav === "payment-return" ? (
              <PaymentReturn
                {...props}
                configured={config?.paymentConfigured || false}
                mode={config?.paymentMode || ""}
              />
            ) : nav === "history" ? (
              <History {...props} />
            ) : (
              <Empty
                title="页面不存在"
                text="返回项目列表继续练习。"
                action={() => go("/projects")}
              />
            )}
          </Suspense>
        </PageBoundary>
      </main>
      <footer>
        <span>项目追问官</span>
        <a href="#/privacy">隐私与服务说明</a>
        <span>每一次追问，都离讲明白更近一步。</span>
        <small>练习反馈仅供参考，不承诺面试或录用结果。</small>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

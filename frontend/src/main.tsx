import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import { LogOut, Menu, X, LoaderCircle } from "lucide-react";
import { api, ApiError, go } from "./api";
import { Workspace } from "./workspace";
import { Loading, Empty, PageBoundary } from "./ui";
import { syncSessionUser } from "./session-user";

import { createRoot } from "react-dom/client";
import "./style.css";
import "./theme.css";
const Home = lazy(() =>
  import("./landing").then((module) => ({ default: module.Home })),
);
const Experience = lazy(() => import("./experience").then(module => ({ default: module.ExperiencePage })));
const ExampleProjects = lazy(() => import("./example-projects").then(module => ({ default: module.ExampleProjects })));
const Account = lazy(() => import("./account").then(module => ({ default: module.Account })));
const PrivacyInfo = lazy(() => import("./privacy").then(module => ({ default: module.PrivacyInfo })));
const Login = lazy(() =>
  import("./home").then((module) => ({ default: module.Login })),
);
const Editor = lazy(() =>
  import("./editor").then((module) => ({ default: module.Editor })),
);
const ProjectInterview = lazy(() =>
  import("./project-practice").then((module) => ({ default: module.ProjectInterview })),
);
const NewProject = lazy(() =>
  import("./new-project").then((module) => ({ default: module.NewProject })),
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
function App() {
  const [path, setPath] = useState(location.hash.slice(1) || "/");
  const [user, setUser] = useState<{ id: string; username: string } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<{
    modelMode: string;
    modelName?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [serviceError, setServiceError] = useState("");
  const [pendingRequests, setPendingRequests] = useState(0);
  const busy = pendingRequests > 0;
  const [menu, setMenu] = useState(false);
  const navigationVersion = useRef(0);
  useEffect(() => {
    const change = () => {
      ++navigationVersion.current;
      setPath(location.hash.slice(1) || "/");
      setError("");
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    api<typeof config>("/config", "GET", undefined, controller.signal)
      .then(setConfig)
      .catch(() => setServiceError("面试服务暂未连接。你可以返回首页使用快捷体验；本地使用请先启动后端再刷新。"));
    api<typeof user>("/me", "GET", undefined, controller.signal)
      .then((value) => {
        if (value) syncSessionUser(value.id);
        setUser(value);
      })
      .catch(() => {})
      .finally(() => { setReady(true); });
    return () => { window.removeEventListener("hashchange", change); window.clearTimeout(timeout); controller.abort(); };
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
  const [route, search] = path.split("?", 2);
  const [, nav, routeId, historyRoundId, exampleRoundId] = route.split("/");
  const projectQuery = new URLSearchParams(search);
  const projectRoundId = nav === "projects" && routeId && routeId !== "new" ? projectQuery.get("roundId") : null;
  const publicHome = path === "/" && !user;
  const exampleHistory = nav === "history" && routeId === "examples";
  const historyProjectId = exampleHistory ? historyRoundId : routeId;
  const historyOverview = nav === "history" && !historyProjectId;
  const publicHistory = exampleHistory || historyOverview;
  const publicPage = nav === "experience" || publicHistory || publicHome;
  const projectsActive = nav === "projects" || (!!user && !nav);
  useEffect(() => {
    if (
      ready &&
      !user &&
      !publicHistory &&
      path !== "/" &&
      path !== "/login" &&
      /^\/(projects|trainings|report|history)(\/|$)/.test(
        path,
      )
    ) {
      sessionStorage.setItem("auth:return", path);
    }
  }, [publicHistory, path, ready, user]);
  useEffect(() => {
    if (user && projectRoundId)
      window.location.replace(`#/history/${routeId}/${encodeURIComponent(projectRoundId)}`);
  }, [user, routeId, projectRoundId]);
  return (
    <>
      <header className={publicHome ? "site-header site-header--public-home" : "site-header"}>
        <div className="header-inner">
        <a className="brand" href="#/">
          <span className="brand-icon" aria-hidden="true">问</span>
          项目追问官
        </a>
        <button
          className="menu-toggle"
          aria-label="切换导航"
          aria-controls="site-navigation"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
        <nav id="site-navigation" className={menu ? "open" : ""} aria-label="主导航">
          <a
            className={nav === "experience" || publicHome ? "selected" : ""}
            aria-current={nav === "experience" ? "page" : undefined}
            href="#/experience"
          >
            示例练习
          </a>
          <a
            className={projectsActive ? "selected" : ""}
            aria-current={projectsActive ? "page" : undefined}
            href="#/projects"
          >
            我的项目
          </a>
          <a className={nav === "history" ? "selected" : ""} aria-current={nav === "history" ? "page" : undefined} href="#/history">
            训练记录
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
                    const version = navigationVersion.current;
                    await api("/auth/logout", "POST");
                    sessionStorage.clear();
                    setUser(null);
                    if (version === navigationVersion.current) go("/");
                  })
                }
              >
                <LogOut size={16} />
              </button>
            </>
          ) : (
            <a className="account-login" href="#/login">
              登录 / 注册
            </a>
          )}
        </div>
        </div>
      </header>
      {(error || (!publicPage && serviceError)) && (
        <div role="alert" className="error">
          <span>{error || serviceError}</span>
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
      <main className={publicHome ? undefined : "app-main"}>
        <PageBoundary key={`${user?.id || "guest"}:${path}`}>
          <Suspense fallback={<Loading />}>
            {nav === "experience" ? (
              routeId ? <ProjectInterview id={routeId} example fromHistory={projectQuery.get("from") === "history"} {...props} /> :
              ["quick", "legacy"].includes(projectQuery.get("mode") || "") ? <Experience /> :
              <ExampleProjects preferred={projectQuery.get("sample")} {...props} />
            ) : publicHistory ? (
              historyOverview && !ready ? <Loading /> :
                <History example={exampleHistory} signedIn={!!user} projectId={historyProjectId} roundId={exampleRoundId} {...props} />
            ) : nav === "privacy" ? <PrivacyInfo /> : publicHome ? (
              <Home
                backendReady={!!config}
                onStart={() => {
                  sessionStorage.setItem("auth:return", "/projects/new");
                  go("/login");
                }}
              />
            ) : !ready ? <Loading /> : !user || path === "/login" ? (
              <Login
                {...props}
                onLogin={(u) => {
                  syncSessionUser(u.id);
                  setUser(u);
                  const next =
                    sessionStorage.getItem("auth:return") || "/projects";
                  sessionStorage.removeItem("auth:return");
                  go(
                    /^\/(projects|trainings|report|history)(\/|$)/.test(next)
                      ? next
                      : "/projects",
                  );
                }}
              />
            ) : nav === "account" ? <Account {...props} /> : path === "/" || nav === "projects" ? (
              route === "/" || route === "/projects" ? (
                <Workspace {...props} />
              ) : route === "/projects/new" ? (
                <NewProject {...props} />
              ) : projectRoundId ? (
                <Loading />
              ) : projectQuery.get("interview") === "1" ? (
                <ProjectInterview key={path} id={routeId} fromHistory={projectQuery.get("from") === "history"} {...props} />
              ) : (
                <Editor key={path} id={routeId} {...props} />
              )
            ) : nav === "trainings" ? (
              <Interview key={path} id={routeId} {...props} />
            ) : nav === "report" ? (
              <ReportPage key={path} id={routeId} {...props} />
            ) : nav === "history" ? (
              <History signedIn projectId={routeId} roundId={historyRoundId} {...props} />
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
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

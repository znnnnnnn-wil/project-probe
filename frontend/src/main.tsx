import React, { useState, useEffect, useCallback } from "react";
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
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const change = () => {
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
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        go("/login");
      }
    } finally {
      setBusy(false);
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
        {!ready ? (
          <Loading />
        ) : path === "/" && !user ? (
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
              const next = sessionStorage.getItem("auth:return") || "/projects";
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
function Home({ onStart }: { onStart: () => void }) {
  const [sampleAnswer, setSampleAnswer] = useState("");
  const [preview, setPreview] = useState(false);
  return (
    <section className="page sample-page">
      <PageHead
        eyebrow="Java 后端 · 项目面试训练"
        title="项目追问官"
        text="从你亲自实现的项目出发，练清楚细节、取舍与验证。"
        action={
          <Button onClick={onStart}>
            开始项目练习
            <ArrowRight size={16} />
          </Button>
        }
      />
      <div className="sample-layout">
        <aside className="sample-project">
          <FolderOpen size={25} />
          <h2>校园自习室预约系统</h2>
          <span className="badge">合成体验项目</span>
          <dl>
            <dt>技术栈</dt>
            <dd>Java / Spring Boot / PostgreSQL</dd>
            <dt>个人职责</dt>
            <dd>预约创建接口、数据库约束与集成测试</dd>
            <dt>当前实现</dt>
            <dd>先查询座位是否空闲，再写入预约记录。</dd>
          </dl>
          <div className="sample-boundary">
            <ShieldCheck size={17} />
            <p>
              此处为固定场景体验，不调用模型，不消耗次数。真实项目训练需登录并核对材料。
            </p>
          </div>
        </aside>
        <div className="sample-practice">
          <div className="question-label">
            <span className="brand-icon">
              <MessageSquare size={17} />
            </span>
            追问官<span>并发边界</span>
          </div>
          <h2>两个请求同时查到座位“空闲”，怎样保证只有一个预约成功？</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPreview(true);
            }}
          >
            <label>
              试着讲清楚你的实现
              <textarea
                aria-label="体验回答"
                rows={6}
                maxLength={2000}
                value={sampleAnswer}
                onChange={(e) => {
                  setSampleAnswer(e.target.value);
                  setPreview(false);
                }}
                placeholder="你的处理顺序、约束所在位置、冲突返回，以及验证方式…"
                required
              />
            </label>
            <div className="answer-bottom">
              <small>{sampleAnswer.length}/2000</small>
              <Button type="submit" disabled={!sampleAnswer.trim()}>
                查看复盘角度
                <ArrowRight size={16} />
              </Button>
            </div>
          </form>
          {preview && (
            <div className="sample-feedback" role="status">
              <h3>
                <Target size={18} /> 这个场景值得继续解释的地方
              </h3>
              <ul>
                <li>检查与写入之间存在时间窗口，最终约束由谁保证？</li>
                <li>两个实例同时写入时，冲突如何返回给调用方？</li>
                <li>怎样构造并发输入，核对数据库中最终的预约数量？</li>
              </ul>
              <p>以上是固定场景的复盘角度，不是对你回答的 AI 评分。</p>
              <Button secondary onClick={onStart}>
                用我的项目开始训练
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
        </div>
      </div>
      <section className="sample-outcomes">
        <div>
          <FileText size={20} />
          <h3>有依据的复盘</h3>
          <p>保留原问答与材料引用，定位需要补充的解释。</p>
        </div>
        <div>
          <Target size={20} />
          <h3>明确的补充任务</h3>
          <p>记录实现和验证笔记，再带着补充内容练习。</p>
        </div>
        <div>
          <RefreshCw size={20} />
          <h3>变化条件的复测</h3>
          <p>回到同一项目的薄弱点，对照两轮回答。</p>
        </div>
      </section>
      <section className="sample-report-example">
        <div className="section-heading">
          <h2>一份有依据的复盘</h2>
          <span>合成项目 · 真实模型输出示例</span>
        </div>
        <figure>
          <img
            src="/report-example.png"
            alt="合成预约项目的真实模型复盘，包含原回答证据与具体补充任务"
            loading="lazy"
            width="872"
            height="524"
          />
          <figcaption>
            来自已验收的合成项目训练。实际反馈取决于你的材料与回答，不保证面试结果。
          </figcaption>
        </figure>
      </section>
    </section>
  );
}
function Login({
  run,
  busy,
  onLogin,
}: Actions & { onLogin: (u: { id: string; username: string }) => void }) {
  const [register, setRegister] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section className="auth-layout">
      <div>
        <div className="eyebrow">从你的项目开始</div>
        <h1>
          给下一次面试，
          <br />
          <span>多一点准备。</span>
        </h1>
        <p>
          注册后，项目材料、回答和复盘将保存在服务端。
          <br />
          请使用合成或脱敏材料，不要填写密钥、手机号等敏感信息。
        </p>
      </div>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () =>
            onLogin(
              await api("/auth/" + (register ? "register" : "login"), "POST", {
                username: name,
                password,
              }),
            ),
          );
        }}
      >
        <h2>{register ? "创建练习账号" : "欢迎回来"}</h2>
        <p>使用独立账号保存你的练习进度。</p>
        <label>
          用户名
          <input
            autoComplete="username"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={10}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 10 个字符"
            required
          />
        </label>
        <Button type="submit" disabled={busy}>
          {register ? "注册并开始" : "登录"}
          <ArrowRight size={17} />
        </Button>
        <button
          type="button"
          className="text-link"
          onClick={() => setRegister(!register)}
        >
          {register ? "已有账号？去登录" : "没有账号？创建一个"}
        </button>
      </form>
    </section>
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
function Editor({ id, run, busy }: Actions & { id: string }) {
  const [importBusy, setImportBusy] = useState(false);
  busy = busy || importBusy;
  const [p, setP] = useState<Project>({ ...emptyProject });
  const [loaded, setLoaded] = useState(id === "new");
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<Training[]>([]);
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
    if (id === "new") restore({ ...emptyProject });
    if (id !== "new")
      run(async () => {
        restore(await api("/projects/" + id));
        setHistory(
          (await api<Training[]>("/trainings")).filter(
            (t) => t.project.id === id,
          ),
        );
        setLoaded(true);
      });
    api<Shop>("/shop")
      .then(setShop)
      .catch(() => {});
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
      if (id === "new") go("/projects/" + result.id);
    });
  const start = (parentId?: string) =>
    run(async () => {
      setStartError("");
      setStarting(!parentId);
      try {
        if (!parentId) setShop(await api<Shop>("/shop"));
        const t = await api<Training>("/trainings", "POST", {
          projectId: id,
          parentId,
          requestKey: parentId ? startKey + "-retest-" + parentId : startKey,
        });
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
    <section className="page">
      <PageHead
        eyebrow="项目档案"
        title={id === "new" ? "整理你的项目经历" : p.name}
        text="保存材料 → 核对事实 → 开始练习。修改材料会保留历史版本，并需要重新核对事实。"
        action={
          <Button secondary onClick={() => go("/projects")}>
            返回项目列表
          </Button>
        }
      />
      <div className="editor-layout">
        <div className="panel">
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="form-fields">
              {fields.map(([key, label, placeholder], i) => (
                <label key={key} className={i < 3 ? "" : "wide"}>
                  {label}
                  {i < 3 ? (
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
            <div className="form-bottom">
              <span>
                {dirty ? "有尚未保存的修改" : "材料已载入；保存后可提取事实"}
              </span>
              <Button type="submit" disabled={busy}>
                保存项目材料 <Check size={16} />
              </Button>
            </div>
          </form>
        </div>
        <aside>
          <div className="panel facts-panel">
            <div className="section-kicker">开始前，先确认</div>
            <h2>项目事实清单</h2>
            <p>
              区分原始材料、推断与待确认信息。核对不意味着每条推断都已被证实。
            </p>
            {id === "new" ? (
              <div className="mini-empty">保存档案后，提取需要核对的事实。</div>
            ) : (
              <>
                <Button
                  secondary
                  disabled={busy || dirty}
                  onClick={() =>
                    run(async () =>
                      setP(await api("/projects/" + id + "/extract", "POST")),
                    )
                  }
                >
                  {p.facts.length ? "读取已提取事实" : "提取项目事实"}
                </Button>
                <small>
                  相同材料复用已提取结果；更新材料并保存后可重新提取。
                </small>
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
                        setP({
                          ...p,
                          factsConfirmed: false,
                          facts: p.facts.map((v, i) =>
                            i === index ? { ...v, text: e.target.value } : v,
                          ),
                        })
                      }
                    />
                    {f.quote && <small>原材料依据：{f.quote}</small>}
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={f.confirmed}
                        onChange={(e) =>
                          setP({
                            ...p,
                            factsConfirmed: false,
                            facts: p.facts.map((v, i) =>
                              i === index
                                ? { ...v, confirmed: e.target.checked }
                                : v,
                            ),
                          })
                        }
                      />{" "}
                      我能确认这一条说明
                    </label>
                  </div>
                ))}
                {p.facts.length > 0 && (
                  <Button
                    secondary
                    disabled={busy || dirty}
                    onClick={() =>
                      run(async () =>
                        setP(
                          await api("/projects/" + id + "/confirm", "POST", {
                            version: p.version,
                            facts: p.facts,
                          }),
                        ),
                      )
                    }
                  >
                    {p.factsConfirmed
                      ? "已核对 · 可重新保存核对"
                      : "保存核对结果"}
                  </Button>
                )}
                <div className="start-block">
                  <Button
                    disabled={busy || dirty || !p.factsConfirmed}
                    onClick={() => start()}
                  >
                    开始项目深挖 <ArrowRight size={16} />
                  </Button>
                  <small>消耗 1 次深挖权益 · 默认 5 个回答</small>
                  <a href="#/shop">查看训练包与剩余次数</a>
                </div>
              </>
            )}
          </div>
          {history
            .filter((t) => t.kind === "DEEP" && t.status === "COMPLETED")
            .map((t) => (
              <div className="panel retest-entry" key={t.id}>
                <RefreshCw size={22} />
                <h3>补充后，再测一次</h3>
                <p>{t.report?.retestTopics.join(" · ")}</p>
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
function History({ run }: Actions) {
  const [items, setItems] = useState<Training[] | null>(null);
  useEffect(() => {
    run(async () => setItems(await api("/trainings")));
  }, [run]);
  return (
    <section className="page">
      <PageHead
        eyebrow="每一步都有记录"
        title="训练记录"
        text="刷新或离开页面不会丢失已提交的回答，继续原训练不重复扣次。"
      />
      {items === null ? (
        <Loading />
      ) : !items.length ? (
        <Empty
          title="还没有开始训练"
          text="先创建并核对项目档案，开始你的第一次深挖。"
          action={() => go("/projects")}
        />
      ) : (
        <div className="panel history-list">
          {items.map((t) => (
            <a
              key={t.id}
              href={
                "#/" +
                (t.status === "COMPLETED" ? "report" : "trainings") +
                "/" +
                t.id
              }
            >
              <div className="card-icon">
                {t.kind === "RETEST" ? <RefreshCw /> : <MessageSquare />}
              </div>
              <div>
                <h3>{t.project.name}</h3>
                <p>
                  {t.kind === "RETEST" ? "专项复测" : "项目深挖"} ·{" "}
                  {new Date(t.createdAt).toLocaleString("zh-CN")} · 已回答{" "}
                  {t.turns.filter((v) => v.answer).length} 题
                </p>
              </div>
              <span className="badge">{statusLabel[t.status]}</span>
              <ChevronRight />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
function Interview({ id, run, busy }: Actions & { id: string }) {
  const [t, setT] = useState<Training | null>(null);
  const [answer, setAnswer] = useState("");
  const load = useCallback(async () => {
    const value = await api<Training>("/trainings/" + id);
    setT(value);
    if (value.status === "COMPLETED") go("/report/" + id);
  }, [id]);
  useEffect(() => {
    run(load);
  }, [load, run]);
  const turn = t?.turns[t.turns.length - 1];
  useEffect(() => {
    setAnswer(
      turn?.answer ||
        sessionStorage.getItem("draft:" + id + ":" + turn?.id) ||
        "",
    );
  }, [id, turn?.id, turn?.answer]);
  useEffect(() => {
    if (t && ["GENERATING", "PENDING"].includes(t.status)) {
      const timer = setInterval(() => load().catch(() => {}), 3000);
      return () => clearInterval(timer);
    }
  }, [t?.status, load]);
  const action = (suffix: string, data?: unknown) =>
    run(async () => {
      try {
        const result = await api<Training>(
          "/trainings/" + id + "/" + suffix,
          "POST",
          data,
        );
        setT(result);
        if (suffix === "answer")
          sessionStorage.removeItem("draft:" + id + ":" + turn?.id);
        if (result.status === "COMPLETED") go("/report/" + id);
      } finally {
        await load();
      }
    });
  if (!t) return <Loading />;
  const count = t.turns.filter((v) => v.answer).length;
  return (
    <section className="page interview-page">
      <PageHead
        eyebrow={
          t.kind === "RETEST"
            ? "专项复测 · 换个场景检查理解"
            : "项目深挖 · 一次只聚焦一个问题"
        }
        title={t.project.name}
        text="如实描述你做过的部分。不确定的地方可以直接说，我们会把它记为待补充。"
        action={
          <span className="badge">
            <span className="status-dot" />
            {statusLabel[t.status]}
          </span>
        }
      />
      <div className="interview-layout">
        <aside className="panel progress-panel">
          <h3>本次练习</h3>
          <div className="progress-number">
            {count.toString().padStart(2, "0")}
            <small> / {t.maxTurns.toString().padStart(2, "0")}</small>
          </div>
          <p>个回答已保存</p>
          <div className="progress-bar">
            <span style={{ width: (count / t.maxTurns) * 100 + "%" }} />
          </div>
          {t.turns.map((v, i) => (
            <div
              className={"progress-item " + (!v.answer ? "current" : "")}
              key={v.id}
            >
              <span>{v.answer ? <Check size={13} /> : i + 1}</span>
              {v.topic}
            </div>
          ))}
          <div className="aside-note">
            <ShieldCheck size={17} />
            <p>已提交内容保存在服务端；未提交草稿仅保留在当前浏览器标签页。</p>
          </div>
          <a href="#/history">离开并稍后继续</a>
        </aside>
        <div>
          <div className="panel question-panel">
            <div className="question-label">
              <span className="brand-icon">
                <MessageSquare size={18} />
              </span>
              追问官{" "}
              <span>问题 {t.turns.length.toString().padStart(2, "0")}</span>
            </div>
            <h2>{turn?.question || "正在准备专项复测首题"}</h2>
            <div className="question-context">
              <Layers size={14} /> 依据本次项目材料与已提交回答 ·{" "}
              {t.modelMode === "demo" ? "规则演示" : "AI 生成"}
            </div>
          </div>
          {t.status === "ACTIVE" && turn ? (
            <form
              className="panel answer-panel"
              onSubmit={(e) => {
                e.preventDefault();
                action("answer", { turnId: turn.id, answer });
              }}
            >
              <label>
                你的回答
                <textarea
                  aria-label="你的回答"
                  autoFocus
                  rows={9}
                  maxLength={6000}
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value);
                    sessionStorage.setItem(
                      "draft:" + id + ":" + turn.id,
                      e.target.value,
                    );
                  }}
                  placeholder="从你的实际实现讲起：做了什么，为什么这样做，如何验证。如果尚未实现，请直接说明。"
                  required
                />
              </label>
              <div className="answer-bottom">
                <span>{answer.length} / 6000</span>
                <Button type="submit" disabled={busy || !answer.trim()}>
                  提交并继续 <ArrowRight size={16} />
                </Button>
              </div>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => action("finish")}
              >
                结束训练并复盘（仅使用已提交回答）
              </button>
            </form>
          ) : (
            <div className="panel recovery">
              <h3>
                {t.status === "FAILED"
                  ? "生成遇到问题，回答仍在"
                  : "REFUNDED" === t.status
                    ? "次数已返还，记录仍保留"
                    : "正在准备下一步"}
              </h3>
              <p>
                {t.error ||
                  "可离开后从训练记录返回。若服务中断，生成任务超时后可恢复。"}
              </p>
              {["FAILED", "PENDING", "GENERATING"].includes(t.status) && (
                <div className="action-row">
                  <Button
                    disabled={
                      busy ||
                      (t.status === "GENERATING" && t.leaseUntil > Date.now())
                    }
                    onClick={() => action("retry")}
                  >
                    <RefreshCw size={16} /> 重试 / 恢复生成
                  </Button>
                  <Button
                    secondary
                    disabled={
                      busy ||
                      (t.status === "GENERATING" && t.leaseUntil > Date.now())
                    }
                    onClick={() => action("refund")}
                  >
                    终止并返还本次次数
                  </Button>
                </div>
              )}
            </div>
          )}
          <details className="panel transcript">
            <summary>查看已经提交的回答（{count}）</summary>
            {t.turns
              .filter((v) => v.answer)
              .map((v) => (
                <div key={v.id}>
                  <h4>{v.question}</h4>
                  <p>{v.answer}</p>
                  <span className="badge">面试补充 · 未独立验证</span>
                </div>
              ))}
          </details>
        </div>
      </div>
    </section>
  );
}
function ReportBody({ report }: { report: Report }) {
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
        </article>
      ))}
    </>
  );
}
function ReportPage({ id, run, busy }: Actions & { id: string }) {
  const [t, setT] = useState<Training | null>(null);
  useEffect(() => {
    run(async () => setT(await api("/trainings/" + id)));
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
        title="看清薄弱点，再往前一步。"
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
          <Button secondary onClick={() => window.print()}>
            打印 / 保存 PDF
          </Button>
        }
      />
      <div className="report-layout">
        <div>
          <ReportBody report={t.report} />
          {t.kind === "RETEST" && (
            <section className="panel comparison">
              <h2>前后回答对照</h2>
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
              onClick={() => go("/projects/" + t.project.id)}
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
function ShopPage({ run, busy }: Actions) {
  const [s, setS] = useState<Shop | null>(null);
  const [key, setKey] = useState(crypto.randomUUID());
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
  return (
    <section className="page">
      <PageHead
        eyebrow="给练习一个完整的闭环"
        title="一次深挖，一次有针对性的复测。"
        text="按次购买，无自动续费。普通中断可继续原训练；系统生成失败可恢复或返还本次训练次数。"
      />
      <div className="shop-layout">
        <article className="package-card">
          <span className="badge">{paymentLabel[s.mode]}商品</span>
          <h2>{s.product.name}</h2>
          <div className="price">
            <small>¥</small>
            {(s.product.amountCents / 100).toFixed(2)}
            <span> / 包</span>
          </div>
          <p>
            {s.mode === "production"
              ? "正式商品价格，以创建订单时金额为准"
              : "演示定价，不代表正式售价"}
          </p>
          <ul>
            <li>
              <Check size={17} />1 次完整项目深挖训练
            </li>
            <li>
              <Check size={17} />1 次绑定该训练的专项复测
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
                await api("/orders", "POST", { requestKey: key });
                setKey(crypto.randomUUID());
                await load();
              })
            }
          >
            创建
            {s.mode === "mock"
              ? "模拟"
              : s.mode === "sandbox"
                ? "沙箱"
                : "正式"}
            订单 <ArrowRight size={17} />
          </Button>
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
        <div>
          <div className="panel balance">
            <h2>我的训练权益</h2>
            <div>
              <p>
                <strong>{s.packages.filter((p) => !p.deep_used).length}</strong>
                剩余深挖次数
              </p>
              <p>
                <strong>
                  {s.packages.filter((p) => !p.retest_used).length}
                </strong>
                剩余关联复测次数
              </p>
            </div>
            <small>复测需先完成对应包的深挖，并从该报告进入。</small>
            <a href="#/projects">
              前往我的项目 <ArrowRight size={15} />
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
                <div className="order" key={o.id}>
                  <div>
                    <span className="badge">
                      {paymentLabel[o.mode] || "未知环境"}
                      {o.can_operate === false ? " · 历史账号订单" : ""}
                    </span>
                    <h3>
                      项目深挖训练包{" "}
                      <span>¥{(o.amount_cents / 100).toFixed(2)}</span>
                    </h3>
                    <small>{o.id}</small>
                    <p>
                      {new Date(o.created_at).toLocaleString("zh-CN")} ·{" "}
                      {orderLabel(o)}
                    </p>
                    {o.query_error && <small>{o.query_error}</small>}
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
                </div>
              ))
            )}
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

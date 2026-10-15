import React, { useState } from "react";
import {
  ArrowRight,
  FolderOpen,
  MessageSquare,
  FileText,
  RefreshCw,
  ShieldCheck,
  Target,
} from "lucide-react";
import { api } from "./api";
import { Button, PageHead } from "./ui";
import type { Actions } from "./ui";
import { RecoverLogin } from "./account";

export function Home({ onStart }: { onStart: () => void }) {
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
export function Login({
  run,
  busy,
  onLogin,
}: Actions & { onLogin: (u: { id: string; username: string }) => void }) {
  const [register, setRegister] = useState(true);
  const [recover, setRecover] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  if (recover) return <section className="page"><RecoverLogin run={run} busy={busy} onBack={() => { setRecover(false); setRegister(false); }} /></section>;
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
        {!register && <button type="button" className="text-link" onClick={() => setRecover(true)}>忘记密码？使用恢复码</button>}
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

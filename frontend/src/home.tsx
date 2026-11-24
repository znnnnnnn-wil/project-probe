import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import { RecoverLogin } from "./account";
import { InterviewerAvatar } from "./interviewer-avatar";
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
      <div className="auth-stage">
        <InterviewerAvatar />
        <span className="auth-stage-brand">
          <span className="brand-icon" aria-hidden="true">问</span>
          项目追问官
        </span>
        <div className="auth-caption">
          <h1>面对面，练习讲清你的项目。</h1>
          <p>
            注册后，项目材料、回答和复盘将保存在服务端。
            请使用合成或脱敏材料，不要填写密钥、手机号等敏感信息。
          </p>
        </div>
      </div>
      <div className="auth-form-side">
        <form
          className="auth-form"
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
          <p>登录后可以保存项目材料、练习面试和查看复盘。</p>
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
          {!register && (
            <button type="button" className="text-link auth-recover" onClick={() => setRecover(true)}>
              忘记密码？使用恢复码
            </button>
          )}
          <Button type="submit" disabled={busy}>
            {register ? "注册并开始" : "登录"}
            <ArrowRight size={17} />
          </Button>
          <button
            type="button"
            className="text-link auth-switch"
            onClick={() => setRegister(!register)}
          >
            {register ? "已有账号？去登录" : "没有账号？创建一个"}
          </button>
        </form>
      </div>
    </section>
  );
}

import React, { useState } from "react";
import { api } from "./api";
import { Button, PageHead } from "./ui";
import type { Actions } from "./ui";
import { DataControls } from "./privacy";
import { UsageSummary } from "./usage-summary";

export function Account({ run, busy }: Actions) {
  const [password, setPassword] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  return <section className="page"><PageHead eyebrow="账户设置" title="账户与数据" text="保管恢复码，管理密码与个人材料。" />
    <div className="panel"><h2>账户恢复</h2><p>验证当前密码后生成一次性恢复码，仅本次显示。请离线妥善保管；重新生成会使旧码失效。没有恢复码时无法自助找回。</p>
      <label>当前密码<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <Button disabled={busy || !password} onClick={() => run(async () => {
        const result = await api<{ recoveryCode: string }>("/account/recovery", "POST", { password });
        setCode(result.recoveryCode); setPassword("");
      })}>生成或更换恢复码</Button>
      {code && <div role="status"><p>请保存恢复码，离开本页后不再显示：</p><code>{code}</code>
        <p><Button secondary onClick={() => { const blob = new Blob(["项目追问官恢复码（保密）\n" + code], { type: "text/plain" });
          const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "项目追问官恢复码.txt"; a.click(); URL.revokeObjectURL(url);
        }}>下载恢复码</Button></p></div>}
      <h2>修改密码</h2><label>新密码<input type="password" autoComplete="new-password" minLength={10} maxLength={72} value={next} onChange={e => setNext(e.target.value)} /></label>
      <Button disabled={busy || !password || next.length < 10} onClick={() => run(async () => {
        await api("/account/password", "POST", { password, newPassword: next }); sessionStorage.clear(); location.hash = "/login"; location.reload();
      })}>修改密码并退出所有设备</Button>
    </div>
    <DataControls run={run} busy={busy} />
    <UsageSummary />
  </section>;
}

export function RecoverLogin({ run, busy, onBack }: Actions & { onBack: () => void }) {
  const [username, setUsername] = useState(""); const [code, setCode] = useState("");
  const [password, setPassword] = useState(""); const [message, setMessage] = useState("");
  return <form className="panel" onSubmit={e => { e.preventDefault(); run(async () => {
    const result = await api<{ message: string }>("/auth/recover", "POST", { username, recoveryCode: code, newPassword: password });
    setMessage(result.message); setCode(""); setPassword("");
  }); }}><h2>使用恢复码找回账户</h2>
    <label>用户名<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
    <label>一次性恢复码<input autoComplete="off" required value={code} onChange={e => setCode(e.target.value)} /></label>
    <label>新密码<input type="password" autoComplete="new-password" minLength={10} maxLength={72} required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <Button type="submit" disabled={busy}>重置密码</Button><Button secondary onClick={onBack}>返回登录</Button>
    {message && <p role="status">{message}</p>}
  </form>;
}

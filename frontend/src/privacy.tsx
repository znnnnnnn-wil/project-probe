import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui";
import type { Actions } from "./ui";
import type { ProjectSummary } from "./types";
import { TrainingSelect } from "./training-select";

export function PrivacyInfo() {
  return <section className="panel"><h2>隐私与服务说明</h2>
    <p>示例项目使用预填材料。面试进度、转写文字和复盘保存在服务端，自首次进入起可在同一浏览器回看 30 天。快捷追问演示在浏览器内处理输入。</p>
    <p>项目材料、问答、报告和已保存笔记用于训练并保存于服务端；回答草稿保留30天，简历识别缓存保留30天。原简历文件和录音不保存，识别出的文字可能成为项目或回答的一部分。</p>
    <p>示例和自有项目面试共用模型服务。真实 AI 模式下，相关材料和问答会发送给服务端配置的模型提供方。语音转写在配置并启用后由百炼处理。请使用合成或有权提供的脱敏内容。</p>
    <p>服务记录注册、材料保存、训练与报告等阶段的使用情况。阶段统计不记录材料或回答原文。模型调用记录用于排查服务故障。</p>
    <p>训练使用开始时保存的项目材料快照。之后修改材料，历史问答与复盘仍引用当时的材料。</p>
    <p>删除项目会清理该项目的材料修订、问答、报告及草稿。注销会撤销登录并清理个人训练内容。历史备份副本可能仍保留，清理或恢复须由运营者核对。</p>
    <p>训练和账户问题可提交反馈并附上请求编号。请勿提交密码或恢复码。</p>
  </section>;
}

export function DataControls({ run, busy }: Actions) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { const controller = new AbortController();
    api<ProjectSummary[]>("/projects?summary=true", "GET", undefined, controller.signal).then(setProjects).catch(() => {});
    return () => controller.abort();
  }, []);
  return <><PrivacyInfo /><section className="panel"><h2>清理个人数据</h2>
    <Button secondary disabled={busy} onClick={() => {
      if (window.confirm("清空本账号全部简历识别缓存？已保存的项目不受影响。")) run(async () => {
        const result = await api<{ message: string }>("/account/resume-cache", "DELETE"); setNotice(result.message);
      });
    }}>清空简历识别缓存</Button>
    <TrainingSelect label="要删除的项目" value={project} onChange={value => { setProject(value); setConfirmation(""); }} disabled={busy}
      options={[{ value: "", label: "选择项目" }, ...projects.map(p => ({ value: p.id!, label: p.name }))]} />
    <label>当前密码（用于数据清理）<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
    <label>确认文字<input value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="删除项目填完整项目名；注销填“注销账户”" /></label>
    <div className="action-row"><Button secondary disabled={busy || !project || !password || confirmation !== projects.find(p => p.id === project)?.name} onClick={() => {
      if (window.confirm("永久删除该项目及全部问答、报告和草稿？")) run(async () => {
        const result = await api<{ message: string }>("/projects/" + project, "DELETE", { password, confirmation });
        setProjects(items => items.filter(p => p.id !== project)); setProject(""); setConfirmation(""); setPassword("");
        sessionStorage.clear(); setNotice(result.message);
      });
    }}>删除所选项目及训练内容</Button>
    <Button secondary disabled={busy || !password || confirmation !== "注销账户"} onClick={() => {
      if (window.confirm("注销会撤销登录并清理个人训练内容。确定注销？")) run(async () => {
        await api("/account", "DELETE", { password, confirmation }); sessionStorage.clear(); location.hash = "/"; location.reload();
      });
    }}>注销账户</Button></div>
    {notice && <p role="status">{notice}</p>}
  </section></>;
}

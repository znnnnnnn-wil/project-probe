import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

type Draft = { turnId: string; answer: string; version: number };
export function useAnswerDraft(trainingId: string, turnId?: string, active = false) {
  const [answer, setAnswer] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [localCopy, setLocalCopy] = useState("");
  const version = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const blocked = useRef(false);
  const key = "draft:" + trainingId + ":" + turnId;
  const current = useRef(answer); current.current = answer;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setReady(false); dirty.current = false; blocked.current = false; version.current = 0;
    const local = sessionStorage.getItem(key) || "";
    let localVersion = -1, unsynced = false;
    try { const meta = JSON.parse(sessionStorage.getItem(key + ".sync") || "null");
      localVersion = meta?.version ?? -1; unsynced = meta?.unsynced === true;
    } catch { /* 兼容旧标签页的纯文本草稿。 */ }
    setLocalCopy("");
    setAnswer(local);
    if (!turnId || !active) return () => controller.abort();
    api<Draft>(`/trainings/${trainingId}/draft`, "GET", undefined, controller.signal).then(draft => {
      if (cancelled || draft.turnId !== turnId) return;
      version.current = draft.version;
      const pendingLocal = unsynced && localVersion === draft.version;
      if (draft.version > 0 && local && local !== draft.answer && !pendingLocal) setLocalCopy(local);
      if (!dirty.current) setAnswer(pendingLocal || draft.version === 0 ? local : draft.answer);
      if (dirty.current) setNotice("已读取云端版本，将保存当前输入。");
      else setNotice(pendingLocal ? "已恢复尚未同步的本地草稿，正在同步。" : draft.version > 0 ? "已恢复服务端草稿；草稿不参与AI评估。" : "输入后自动保存草稿，保留30天。");
      dirty.current = dirty.current || pendingLocal || (draft.version === 0 && !!local);
      setReady(true);
    }).catch(() => { if (!cancelled) setNotice("草稿同步失败，当前内容仍保留在此标签页。重新打开训练可重试。"); });
    return () => { cancelled = true; controller.abort(); };
  }, [trainingId, turnId, active, key]);
  useEffect(() => {
    if (!ready || !active || !turnId) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (!dirty.current || saving.current || blocked.current) return;
      const value = current.current; saving.current = true;
      try {
        const saved = await api<Draft>(`/trainings/${trainingId}/draft`, "PUT", { turnId, answer: value, version: version.current });
        if (cancelled) return;
        version.current = saved.version; dirty.current = current.current !== value;
        sessionStorage.setItem(key + ".sync", JSON.stringify({ version: saved.version, unsynced: dirty.current }));
        setNotice(dirty.current ? "正在保存新修改…" : "草稿已同步到服务端，尚未提交。");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 409) blocked.current = true;
        setNotice(e instanceof ApiError && e.status === 409 ? e.message + "；本页草稿仍保留。" : "草稿同步失败，将自动重试；本页内容仍保留。");
      } finally { saving.current = false; }
    }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [ready, active, trainingId, turnId]);
  const edit = (value: string) => {
    setAnswer(value); current.current = value; dirty.current = true;
    sessionStorage.setItem(key, value);
    sessionStorage.setItem(key + ".sync", JSON.stringify({ version: version.current, unsynced: true }));
  };
  return { answer, edit, notice, localCopy, restoreLocal: () => { edit(localCopy); setLocalCopy(""); } };
}

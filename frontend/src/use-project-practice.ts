import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Report, Turn } from "./types";

export type Practice = { status: string; turns?: Turn[]; report?: Report; modelMode?: string; leaseUntil?: number };
export function useProjectPractice(projectId: string) {
  const [value, setValue] = useState<Practice>({ status: "LOADING" });
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const sequence = useRef(0);
  const working = useRef(false);
  const reading = useRef(false);
  const current = useRef(answer); current.current = answer;
  const key = "practice-draft:" + projectId;
  const accept = useCallback((next: Practice) => {
    setValue(next); setError(""); setLoadError(false);
    const submitted = next.turns?.[0]?.answer;
    if (next.report || next.status === "USED") {
      sessionStorage.removeItem(key); setAnswer(""); setNotice("");
    } else if (submitted) {
      setAnswer(submitted); sessionStorage.removeItem(key);
      setNotice("回答已提交并保存在服务端；恢复生成不会重复提交。");
    }
  }, [key]);
  const load = useCallback(async () => {
    if (working.current || reading.current) return;
    reading.current = true;
    const version = ++sequence.current;
    try {
      const next = await api<Practice>(`/projects/${projectId}/practice`);
      if (mounted.current && version === sequence.current) accept(next);
    } catch (e) {
      if (mounted.current && version === sequence.current) {
        setLoadError(true); setError(e instanceof Error ? e.message : "体验状态读取失败");
      }
    } finally { reading.current = false; }
  }, [projectId, accept]);
  useEffect(() => {
    mounted.current = true;
    const saved = sessionStorage.getItem(key)?.slice(0, 3000) || "";
    if (saved) { setAnswer(saved); current.current = saved; setNotice("已恢复此标签页的体验草稿；尚未提交。"); }
    void load();
    return () => { mounted.current = false; ++sequence.current; };
  }, [key, load]);
  useEffect(() => {
    if (value.status !== "GENERATING") return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [value.status, load]);
  const submitted = !!value.turns?.[0]?.answer;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (current.current.trim() && !submitted && !value.report) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [submitted, value.report]);
  const edit = (text: string) => {
    current.current = text; setAnswer(text);
    sessionStorage.setItem(key, text);
    setNotice("草稿自动保存在当前标签页，提交后才用于AI反馈。");
  };
  const submit = async () => {
    if (working.current || loadError || ["LOADING", "GENERATING"].includes(value.status)) return;
    working.current = true; ++sequence.current; setPending(true); setError("");
    try {
      const next = await api<Practice>(`/projects/${projectId}/practice`, "POST", submitted ? {} : answer.trim() ? { answer } : {});
      if (mounted.current) accept(next);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 409) {
        try { accept(await api<Practice>(`/projects/${projectId}/practice`)); }
        catch { setLoadError(true); setError("状态已变化，暂未读到最新进度，请重新读取。"); }
      } else {
        setError(e instanceof Error ? e.message : "体验失败");
        setValue(v => ({ ...v, status: "FAILED" }));
      }
    } finally { working.current = false; if (mounted.current) setPending(false); }
  };
  return { value, answer, edit, error, loadError, pending, notice, submitted, load, submit };
}

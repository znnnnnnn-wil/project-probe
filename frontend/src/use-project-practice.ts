import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { practiceProjectPath } from "./practice-paths";
import type { Report, Turn } from "./types";
export type Retest = {
  findingIndex: number;
  turnId: string;
  answer: string;
  status: "GENERATING" | "FAILED" | "COMPLETED";
  report?: Report;
};
type PracticeTurn = Turn & {
  explanation?: string;
  referenceAnswer?: string;
  exchanges?: { answer: string; reply: string; referenceAnswer?: string }[];
};
export type Practice = {
  status: string;
  roundId?: string;
  roundNumber?: number;
  turns?: PracticeTurn[];
  report?: Report;
  modelMode?: string;
  leaseUntil?: number;
  maxTurns?: number;
  interviewTopic?: string;
  retest?: Retest;
  pendingExchange?: { turnId: string; answer: string; exchangeCount: number };
};
export function useProjectPractice(projectId: string, roundId?: string, example = false) {
  const [value, setValue] = useState<Practice>({ status: "LOADING" });
  const [answer, setAnswer] = useState("");
  const [staleDraft, setStaleDraft] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(false);
  const [reportRound, setReportRound] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const cancelRequest = useRef(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const sequence = useRef(0);
  const working = useRef(false);
  const reading = useRef(false);
  const current = useRef(answer); current.current = answer;
  const acceptedTurn = useRef("");
  const acceptedRound = useRef("");
  const endpoint = practiceProjectPath(projectId, example) + "/practice";
  const readEndpoint = roundId ? endpoint + "?roundId=" + encodeURIComponent(roundId) : endpoint;
  const key = "practice-draft:" + projectId;
  const roundKey = "practice-draft-round:" + projectId;
  const turnKey = "practice-draft-turn:" + projectId;
  const exchangeKey = "practice-draft-exchange:" + projectId;
  const matchesDraftTarget = useCallback((practice: Practice) => {
    const turn = practice.turns?.at(-1);
    const draftRound = sessionStorage.getItem(roundKey);
    return !!turn && (!draftRound || draftRound === practice.roundId) &&
      sessionStorage.getItem(turnKey) === turn.id &&
      sessionStorage.getItem(exchangeKey) === String(turn.exchanges?.length ?? 0);
  }, [exchangeKey, roundKey, turnKey]);
  const clearDraft = useCallback(() => {
    current.current = "";
    setAnswer("");
    setStaleDraft(false);
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(roundKey);
    sessionStorage.removeItem(turnKey);
    sessionStorage.removeItem(exchangeKey);
  }, [exchangeKey, key, roundKey, turnKey]);
  const discardDraft = () => {
    clearDraft();
    setNotice("");
  };
  const accept = useCallback((next: Practice) => {
    setValue(next); setError(""); setLoadError(false);
    if (roundId) return;
    const turn = next.turns?.at(-1);
    const submitted = turn?.answer;
    const draftTurn = sessionStorage.getItem(turnKey);
    const draftExchange = sessionStorage.getItem(exchangeKey);
    const changed = (!!acceptedTurn.current && acceptedTurn.current !== turn?.id) || (!!draftTurn && !!turn && draftTurn !== turn.id);
    const roundChanged = !!acceptedRound.current && acceptedRound.current !== next.roundId;
    acceptedTurn.current = turn?.id || "";
    acceptedRound.current = next.roundId || "";
    if (next.report || roundChanged || next.status === "AVAILABLE") {
      clearDraft();
      setNotice("");
    } else if (submitted) {
      clearDraft();
      setAnswer(submitted);
      setNotice("回答已提交并保存在服务端；恢复生成不会重复提交。");
    } else if (changed) {
      clearDraft();
      setNotice("上一题回答已保存，请继续当前追问。");
    } else if (draftTurn === turn?.id && draftExchange !== null && current.current.trim() && (
      (next.pendingExchange?.turnId === draftTurn &&
        next.pendingExchange.exchangeCount === Number(draftExchange) &&
        next.pendingExchange.answer === current.current.trim()) ||
      turn?.exchanges?.[Number(draftExchange)]?.answer === current.current.trim()
    )) {
      clearDraft();
      setNotice("");
    } else {
      const stale = !!turn && !!current.current.trim() && !matchesDraftTarget(next);
      setStaleDraft(stale);
      if (stale) setNotice("");
    }
  }, [clearDraft, exchangeKey, matchesDraftTarget, roundId, turnKey]);
  const acceptRetest = useCallback((next: Practice) => {
    const currentRound = roundId || acceptedRound.current;
    if (mounted.current && (!currentRound || next.roundId === currentRound)) accept(next);
  }, [accept, roundId]);
  const load = useCallback(async () => {
    if (working.current || reading.current || cancelRequest.current) return;
    reading.current = true;
    const version = ++sequence.current;
    try {
      const next = await api<Practice>(readEndpoint);
      if (mounted.current && version === sequence.current) accept(next);
    } catch (e) {
      if (mounted.current && version === sequence.current) {
        setLoadError(true); setError(e instanceof Error ? e.message : "训练状态读取失败");
      }
    } finally { reading.current = false; }
  }, [readEndpoint, accept]);
  useEffect(() => {
    mounted.current = true;
    const saved = roundId ? "" : sessionStorage.getItem(key)?.slice(0, 6000) || "";
    if (saved) { setAnswer(saved); current.current = saved; setNotice("已恢复此标签页的回答草稿。"); }
    void load();
    return () => { mounted.current = false; ++sequence.current; };
  }, [key, load, roundId]);
  const generating = value.status === "GENERATING" || value.retest?.status === "GENERATING";
  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [generating, load]);
  const submitted = !!value.turns?.at(-1)?.answer;
  const finalTurn = (value.turns?.length ?? 0) >= (value.maxTurns || 1);
  const activeRound = value.roundId;
  const reportGenerating = !value.report && finalTurn && (pending || value.status === "GENERATING")
    && (submitted || (!!activeRound && reportRound === activeRound));
  useEffect(() => {
    if (roundId || !pending || !finalTurn || submitted || !activeRound) return;
    const controller = new AbortController();
    const progressPath = endpoint + "?roundId=" + encodeURIComponent(activeRound);
    // The last answer is committed before the synchronous POST finishes generating the report.
    // Only observe its phase here. The POST still owns updating the practice state.
    let timer = window.setTimeout(checkProgress, 600);
    async function checkProgress() {
      const next = await api<Practice>(progressPath, "GET", undefined, controller.signal).catch(() => null);
      if (controller.signal.aborted) return;
      if (next && next.roundId === activeRound && next.turns?.at(-1)?.answer &&
        (next.status === "GENERATING" || next.status === "COMPLETED")) {
        setReportRound(activeRound);
        return;
      }
      timer = window.setTimeout(checkProgress, 1500);
    }
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeRound, endpoint, finalTurn, pending, roundId, submitted]);
  useEffect(() => {
    if (roundId) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (current.current.trim() && !submitted && !value.report) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [roundId, submitted, value.report]);
  const edit = (text: string) => {
    current.current = text; setAnswer(text);
    setStaleDraft(false);
    sessionStorage.setItem(key, text);
    if (value.roundId) sessionStorage.setItem(roundKey, value.roundId);
    const turn = value.turns?.at(-1);
    if (turn) {
      sessionStorage.setItem(turnKey, turn.id);
      sessionStorage.setItem(exchangeKey, String(turn.exchanges?.length ?? 0));
    }
    setNotice("未发送的回答已保存在当前标签页。");
  };
  const cancel = async () => {
    if (roundId || !value.roundId || value.report || cancelRequest.current) return false;
    cancelRequest.current = true;
    const version = ++sequence.current;
    const isCurrent = () => mounted.current && version === sequence.current;
    setCancelling(true); setError("");
    try {
      const next = await api<Practice>(endpoint + "/cancel", "POST", { roundId: value.roundId });
      if (!isCurrent()) return false;
      accept(next);
      return true;
    } catch (e) {
      if (!isCurrent()) return false;
      try {
        const next = await api<Practice>(readEndpoint);
        if (!isCurrent()) return false;
        accept(next);
        if (next.status === "AVAILABLE") return true;
        if (!next.report) setError(e instanceof Error ? e.message : "取消面试失败，请重试");
      } catch {
        if (isCurrent()) {
          setLoadError(true);
          setError("取消结果暂未确认，请重新读取训练状态。");
        }
      }
      return false;
    } finally {
      cancelRequest.current = false;
      if (mounted.current) setCancelling(false);
    }
  };
  const submit = async (utterance?: string, restart = false, topic = "", onSentence?: (sentence: string, speechTicket?: string) => void) => {
    if (roundId || working.current || cancelRequest.current || loadError || ["LOADING", "GENERATING"].includes(value.status)) return;
    if (restart && !value.roundId) return;
    const turn = value.turns?.at(-1);
    const text = (utterance ?? current.current).trim();
    if (!restart && utterance === undefined && text && !submitted && !value.pendingExchange && turn &&
        !matchesDraftTarget(value)) return;
    const selectedTopic = topic.trim();
    const topicInput = selectedTopic ? { topic: selectedTopic } : {};
    const message = restart ? { ...topicInput, restart: true, roundId: value.roundId } : !submitted && !value.pendingExchange && turn && text
      ? { answer: text, turnId: turn.id, dialogue: true, exchangeCount: turn.exchanges?.length ?? 0 }
      : !value.roundId && !turn ? topicInput : {};
    const version = ++sequence.current;
    const isCurrent = () => mounted.current && version === sequence.current;
    working.current = true; setPending(true); setError("");
    // Keep transcribed text retriable if the reply request fails before it reaches the server.
    if (utterance && "answer" in message && !current.current.trim()) edit(text);
    try {
      const next = await api<Practice>(endpoint, "POST", message, undefined,
        onSentence && ((sentence, ticket) => { if (isCurrent()) onSentence(sentence, ticket); }));
      if (isCurrent()) { accept(next); return next; }
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof ApiError && e.status === 409) {
        try {
          const next = await api<Practice>(readEndpoint);
          if (isCurrent()) accept(next);
        } catch {
          if (isCurrent()) {
            setLoadError(true);
            setError("状态已变化，暂未读到最新进度，请重新读取。");
          }
        }
      } else {
        const message = e instanceof Error ? e.message : "训练请求失败";
        if (e instanceof ApiError && e.status === 503) {
          const state = await api<Practice>(readEndpoint).catch(() => null);
          if (!isCurrent()) return;
          if (state?.status === "FAILED") {
            accept(state);
            setError(message);
            return;
          }
        }
        setError(message);
        setValue(previous => ({ ...previous, status: "FAILED" }));
      }
    } finally {
      working.current = false;
      if (mounted.current) {
        setPending(false);
        if (!isCurrent()) void load();
      }
    }
  };
  return { endpoint, value, answer, staleDraft, edit, discardDraft, error, loadError, pending, cancelling, notice, submitted, finalTurn, reportGenerating, load, submit, cancel, acceptRetest };
}

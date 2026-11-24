import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mic, Square, X, LoaderCircle, Plus, AudioLines, Check } from "lucide-react";
import type { VoiceActivity } from "./voice-activity";
import "./experience-voice.css";
interface SpeechResultLike {
  0: { transcript: string };
}
interface SpeechResultEventLike {
  results: { length: number; [index: number]: SpeechResultLike };
}
interface SpeechErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
function recognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const MAX_SECONDS = 180;
const CONNECTION_TIMEOUT = 10000;
const RESULT_TIMEOUT = 5000;

type VoiceState = "idle" | "requesting" | "recording" | "finishing";
type VoiceSession = {
  recognizer: SpeechRecognitionLike;
  phase: Exclude<VoiceState, "idle">;
  text: string;
  heard: boolean;
  stream?: MediaStream;
  context?: AudioContext;
  node?: AudioWorkletNode;
  vad?: VoiceActivity;
  clock?: number;
  timeout?: number;
};

function releaseSession(voice: VoiceSession, abort: boolean) {
  window.clearTimeout(voice.timeout);
  window.clearInterval(voice.clock);
  const recognizer = voice.recognizer;
  recognizer.onstart = null;
  recognizer.onspeechstart = null;
  recognizer.onresult = null;
  recognizer.onerror = null;
  recognizer.onend = null;
  if (abort) {
    try {
      recognizer.abort();
    } catch {
      // A browser may already have ended this recognition session.
    }
  }
  voice.node?.disconnect();
  voice.stream?.getTracks().forEach(track => track.stop());
  void voice.vad?.destroy().catch(() => {});
  void voice.context?.close().catch(() => {});
}

export function ExperienceVoice({
  disabled,
  remaining,
  onAppend,
  onBusy,
  auto = false,
  suspended = false,
}: {
  disabled: boolean;
  remaining: number;
  onAppend: (text: string) => void;
  onBusy?: (busy: boolean) => void;
  auto?: boolean;
  suspended?: boolean;
}) {
  const [supported] = useState(() => recognitionCtor() !== null);
  const [state, setState] = useState<VoiceState>("idle");
  const [language, setLanguage] = useState("zh-CN");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState("");
  const [heard, setHeard] = useState(false);
  const [vadReady, setVadReady] = useState(false);
  const [autoStop, setAutoStop] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [overflow, setOverflow] = useState("");
  const [paused, setPaused] = useState(false);

  const session = useRef<VoiceSession | null>(null);
  const blocked = disabled || (auto && (suspended || paused));
  const current = useRef({ remaining, onAppend, blocked, autoStop: auto || autoStop });
  current.current = { remaining, onAppend, blocked, autoStop: auto || autoStop };
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  useEffect(() => {
    return () => {
      const voice = session.current;
      session.current = null;
      if (voice) releaseSession(voice, true);
      busyCallback.current?.(false);
    };
  }, []);
  const busy = auto
    ? state === "finishing" || (state === "recording" && heard)
    : state !== "idle";
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);

  const reset = () => {
    setLive("");
    setHeard(false);
    setVadReady(false);
    setLevel(0);
    setSeconds(0);
  };

  const settle = (voice: VoiceSession, commit: boolean, abort: boolean, message = "") => {
    if (session.current !== voice) return;
    session.current = null;
    releaseSession(voice, abort);
    setState("idle");
    reset();
    if (!commit) {
      if (message) setError(message);
      return;
    }
    if (auto && current.current.blocked) return;
    const text = voice.text.trim();
    if (!text) {
      if (auto && !message && !voice.heard) return;
      setError(message || (voice.heard
        ? "已检测到说话，浏览器未返回文字。请确认识别语言后重试"
        : "浏览器未识别到语音，请检查麦克风选项后重试"));
      return;
    }
    if (text.length > current.current.remaining || current.current.blocked) {
      setOverflow(text);
      setError("识别文字超出剩余字数，请精简后加入回答");
      return;
    }
    current.current.onAppend(text);
    if (!auto) setNotice("语音已填入回答");
  };

  const requestStop = (voice: VoiceSession) => {
    if (session.current !== voice || voice.phase !== "recording") return;
    voice.phase = "finishing";
    setState("finishing");
    window.clearInterval(voice.clock);
    voice.timeout = window.setTimeout(() => {
      settle(voice, true, true, "浏览器语音识别返回超时，请重试");
    }, RESULT_TIMEOUT);
    try {
      // Keep receiving events until the recognizer returns the last phrase.
      voice.recognizer.stop();
    } catch {
      settle(voice, true, true, "浏览器语音识别中断，请重试");
    }
  };

  const monitorAudio = async (voice: VoiceSession, stream: MediaStream) => {
    const active = () => session.current === voice && voice.phase !== "finishing";
    try {
      const context = new AudioContext({ sampleRate: 16000 });
      voice.context = context;
      await context.audioWorklet.addModule("/voice-recorder.js");
      if (!active()) return;
      await context.resume();
      if (!active()) return;

      const node = new AudioWorkletNode(context, "voice-recorder");
      voice.node = node;
      node.port.onmessage = (event) => {
        if (session.current !== voice || voice.phase !== "recording") return;
        const chunk = event.data as Float32Array;
        if (!auto) {
          const rms = Math.sqrt(
            chunk.reduce((sum, value) => sum + value * value, 0) / chunk.length,
          );
          setLevel(Math.min(100, rms * 400));
        }
        voice.vad?.feed(chunk);
      };
      context.createMediaStreamSource(stream).connect(node);
      const mute = context.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(context.destination);

      const { VoiceActivity } = await import("./voice-activity");
      if (!active()) return;
      const vad = await VoiceActivity.create(
        context.sampleRate,
        () => {
          if (session.current !== voice || voice.phase !== "recording") return;
          voice.heard = true;
          setHeard(true);
        },
        () => {
          if (current.current.autoStop) requestStop(voice);
        },
        () => {
          if (session.current !== voice || voice.phase !== "recording") return;
          const failed = voice.vad;
          voice.vad = undefined;
          void failed?.destroy().catch(() => {});
          setVadReady(false);
        },
      );
      if (!active()) {
        await vad.destroy();
        return;
      }
      voice.vad = vad;
      setVadReady(true);
    } catch {
      if (session.current === voice) setVadReady(false);
    }
  };

  const start = async () => {
    if (session.current || current.current.blocked) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持录音，请改用新版浏览器或文字回答");
      return;
    }
    setError("");
    setNotice("");
    setOverflow("");
    reset();
    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      setError("无法启动浏览器语音识别，请重试");
      return;
    }
    const voice: VoiceSession = { recognizer: rec, phase: "requesting", text: "", heard: false };
    session.current = voice;
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (session.current !== voice) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      voice.stream = stream;
    } catch (cause) {
      settle(voice, false, true, cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "麦克风权限未允许，请在浏览器中允许后重试"
        : "无法启动麦克风，请检查设备后重试");
      return;
    }
    const [track] = stream.getAudioTracks();
    if (!track) {
      settle(voice, false, true, "没有可用的麦克风输入，请检查所选设备");
      return;
    }

    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      if (session.current !== voice || voice.phase !== "requesting") return;
      voice.phase = "recording";
      window.clearTimeout(voice.timeout);
      setState("recording");
      const started = performance.now();
      voice.clock = window.setInterval(() => {
        const elapsed = (performance.now() - started) / 1000;
        if (!auto) setSeconds(Math.floor(elapsed));
        if (elapsed >= MAX_SECONDS || (voice.vad && current.current.autoStop && !voice.heard && elapsed >= 10))
          requestStop(voice);
      }, 250);
    };
    rec.onspeechstart = () => {
      if (session.current !== voice) return;
      voice.heard = true;
      setHeard(true);
    };
    rec.onresult = (event) => {
      if (session.current !== voice) return;
      voice.text = Array.from(event.results, result => result[0].transcript).join("").trim();
      if (voice.text) {
        voice.heard = true;
        setHeard(true);
      }
      if (!auto) setLive(voice.text);
    };
    rec.onerror = (event) => {
      const messages: Record<string, string> = {
        "not-allowed": "浏览器未授予语音识别权限，请检查网站设置后重试",
        "service-not-allowed": "当前浏览器的语音识别服务不可用，请换浏览器重试",
        "audio-capture": "浏览器无法访问麦克风，请检查所选输入设备",
        "network": "浏览器的语音识别服务连接失败，请检查网络后重试",
        "language-not-supported": "当前浏览器不支持所选识别语言，请切换语言或浏览器",
      };
      const message = event.error === "no-speech" ? "" : messages[event.error] || "浏览器语音识别中断，请重试";
      settle(voice, true, true, message);
    };
    rec.onend = () => settle(voice, true, false);
    voice.timeout = window.setTimeout(() => {
      settle(voice, true, true, "浏览器语音识别服务启动超时，请重试");
    }, CONNECTION_TIMEOUT);
    try {
      rec.start(track);
    } catch {
      settle(voice, false, true, "无法启动浏览器语音识别，请重试");
      return;
    }
    if (session.current === voice) void monitorAudio(voice, stream);
  };

  const startRef = useRef(start);
  startRef.current = start;
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useLayoutEffect(() => {
    if (auto && blocked && session.current)
      settleRef.current(session.current, false, true);
  }, [auto, blocked]);
  useEffect(() => {
    if (!auto || blocked || error || state !== "idle" || !supported || remaining <= 0)
      return;
    void startRef.current();
  }, [auto, blocked, error, state, supported, remaining]);

  const addOverflow = () => {
    const text = overflow.trim();
    if (blocked || !text || text.length > remaining) return;
    current.current.onAppend(text);
    setOverflow("");
    setError("");
    if (!auto) setNotice("语音已填入回答");
  };
  const overflowEditor = overflow && (
    <div className="exp-voice-overflow">
      <label>
        识别结果（超出剩余字数，可精简）
        <textarea
          aria-label="语音识别结果"
          rows={4}
          maxLength={6000}
          value={overflow}
          onChange={(e) => setOverflow(e.target.value)}
        />
      </label>
      <div className="exp-voice-overflow-actions">
        <small>
          {overflow.trim().length} 字 · 剩余 {Math.max(0, remaining)} 字
        </small>
        <button
          type="button"
          className="button secondary"
          disabled={blocked || !overflow.trim() || overflow.trim().length > remaining}
          onClick={addOverflow}
        >
          <Plus size={16} aria-hidden="true" />
          加入回答
        </button>
      </div>
    </div>
  );

  if (auto) {
    let status = "正在准备麦克风";
    if (!supported) status = "当前浏览器不支持语音识别";
    else if (paused) status = "麦克风已暂停";
    else if (error) status = "语音面试已暂停";
    else if (blocked) status = "轮到你时，麦克风会自动恢复";
    else if (state === "finishing") status = "正在转写这段回答";
    else if (state === "recording") {
      status = heard ? "正在听你说话" : "麦克风已开启，可以直接说话";
    }

    return (
      <div className="exp-voice practice-conversation-voice">
        <div className="exp-voice-bar">
          <span className="exp-voice-title">
            <AudioLines size={16} aria-hidden="true" />
            <span role="status">{status}</span>
          </span>
          {supported && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                if (paused) setError("");
                else if (session.current) settle(session.current, false, true);
                setPaused(!paused);
              }}
            >
              {paused ? "继续语音面试" : "暂停语音面试"}
            </button>
          )}
        </div>
        {!paused && error && (
          <>
            <p className="exp-voice-error" role="alert">{error}</p>
            {overflow ? overflowEditor : (
              <div className="exp-voice-bar">
                <button
                  type="button"
                  className="button secondary"
                  disabled={blocked}
                  onClick={() => setError("")}
                >
                  重试麦克风
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const active = state !== "idle";
  const canStart = supported && !disabled && remaining > 0 && !active;
  const minutes = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");

  return (
    <div className={"exp-voice" + (state === "recording" ? " is-live" : "")}>
      <div className="exp-voice-bar">
        <span className="exp-voice-title">
          <AudioLines size={16} aria-hidden="true" />
          语音输入
          <small>说话自动转文字 · 静音自动结束</small>
        </span>
        {state === "idle" && (
          <div className="exp-voice-actions">
            <select
              aria-label="识别语言"
              value={language}
              disabled={!supported || disabled}
              onChange={event => setLanguage(event.target.value)}
            >
              <option value="zh-CN">普通话</option>
              <option value="en-US">English</option>
            </select>
            <button
              type="button"
              className="exp-voice-mic"
              onClick={() => void start()}
              disabled={!canStart}
              title={
                !supported
                  ? "当前浏览器不支持语音识别"
                  : remaining <= 0
                    ? "回答字数已满"
                    : "开始语音输入"
              }
              aria-label="开始语音输入"
            >
              <Mic size={16} aria-hidden="true" />
              开始说话
            </button>
          </div>
        )}
        {state === "requesting" && (
          <span className="exp-voice-connecting" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            正在连接语音识别
          </span>
        )}
        {state === "finishing" && (
          <span className="exp-voice-connecting" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
            正在接收识别结果
          </span>
        )}
        {state === "recording" && (
          <span className="exp-voice-live-tag" role="status">
            <span className="exp-voice-dot" aria-hidden="true" />
            录音中
          </span>
        )}
      </div>

      {state === "recording" && (
        <div className="exp-voice-panel">
          <div className="exp-voice-meter-row">
            <span className="exp-voice-time">
              {minutes}:{secs} / 3:00
            </span>
            <div className="exp-voice-meter" aria-hidden="true">
              <span style={{ width: level + "%" }} />
            </div>
            <span className={"exp-voice-vad" + (heard ? " is-heard" : "")}>
              {vadReady
                ? heard
                  ? "正在聆听，停顿后自动结束"
                  : "等待说话…"
                : "手动结束录音"}
            </span>
          </div>
          <div className="exp-voice-transcript" aria-live="polite">
            {live ? (
              <p>{live}</p>
            ) : (
              <p className="exp-voice-placeholder">
                开始说话，识别文字会实时显示在这里…
              </p>
            )}
          </div>
          <div className="exp-voice-controls">
            <label className="exp-voice-toggle">
              <input
                type="checkbox"
                checked={autoStop}
                onChange={(e) => setAutoStop(e.target.checked)}
              />
              静音自动结束
            </label>
            <div className="exp-voice-buttons">
              <button
                type="button"
                className="exp-voice-cancel"
                onClick={() => {
                  const voice = session.current;
                  if (voice) settle(voice, false, true);
                }}
                aria-label="取消录音"
              >
                <X size={16} aria-hidden="true" />
                取消
              </button>
              <button
                type="button"
                className="exp-voice-stop"
                onClick={() => {
                  const voice = session.current;
                  if (voice) requestStop(voice);
                }}
                aria-label="结束并填入回答"
              >
                <Square size={14} aria-hidden="true" />
                结束并填入
              </button>
            </div>
          </div>
        </div>
      )}

      {overflowEditor}

      {notice && !error && (
        <p className="exp-voice-notice" role="status">
          <Check size={14} aria-hidden="true" />
          {notice}
        </p>
      )}
      {!supported && (
        <p className="exp-voice-notice is-muted">
          当前浏览器不支持语音识别，请使用 Chrome / Edge，或直接文字回答。
        </p>
      )}
      {error && (
        <p className="exp-voice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

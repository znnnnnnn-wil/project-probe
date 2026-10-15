import React, { useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  X,
  FileText,
  Plus,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { api, upload } from "./api";
import type { VoiceActivity } from "./voice-activity";

export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((letter, i) =>
      view.setUint8(offset + i, letter.charCodeAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, count * 2, true);
  let offset = 44;
  chunks.forEach((chunk) =>
    chunk.forEach((value) => {
      const bounded = Math.max(-1, Math.min(1, value));
      view.setInt16(
        offset,
        Math.round(bounded * (bounded < 0 ? 32768 : 32767)),
        true,
      );
      offset += 2;
    }),
  );
  return new Blob([buffer], { type: "audio/wav" });
}

export function VoiceInput({
  trainingId,
  turnId,
  disabled,
  remaining,
  onAppend,
  onBusy,
}: {
  trainingId: string;
  turnId: string;
  disabled: boolean;
  remaining: number;
  onAppend: (text: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [state, setState] = useState<
    "idle" | "requesting" | "recording" | "recorded" | "transcribing"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState("");
  const speechDetected = useRef(false);
  const inFlight = useRef(false);
  const current = useRef({ remaining, onAppend, disabled });
  current.current = { remaining, onAppend, disabled };
  const resources = useRef<{
    stream?: MediaStream;
    context?: AudioContext;
    node?: AudioWorkletNode;
    timer?: number;
    vad?: VoiceActivity;
  }>({});
  const chunks = useRef<Float32Array[]>([]);
  const samples = useRef(0);
  const blob = useRef<Blob | null>(null);
  const mounted = useRef(true);
  const recording = useRef(false);
  const url = useRef("");
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  const release = () => {
    recording.current = false;
    window.clearInterval(resources.current.timer);
    resources.current.node?.disconnect();
    resources.current.stream?.getTracks().forEach((track) => track.stop());
    void resources.current.vad?.destroy().catch(() => {});
    void resources.current.context?.close().catch(() => {});
    resources.current = {};
  };
  useEffect(() => {
    mounted.current = true;
    api<{ speechEnabled?: boolean }>("/config")
      .then((config) => {
        if (mounted.current) setEnabled(!!config.speechEnabled);
      })
      .catch(() => {
        if (mounted.current) setEnabled(false);
      });
    return () => {
      mounted.current = false;
      release();
      URL.revokeObjectURL(url.current);
      busyCallback.current(false);
    };
  }, []);
  useEffect(() => {
    onBusy(["requesting", "recording", "transcribing"].includes(state));
  }, [state, onBusy]);
  const stop = (speechAudio?: Float32Array) => {
    if (!recording.current) return;
    const rate = resources.current.context!.sampleRate;
    release();
    if (samples.current < rate / 2) {
      setError("录音不足0.5秒，请重新录制");
      setState("idle");
      return;
    }
    blob.current = encodeWav(
      speechAudio ? [speechAudio] : chunks.current,
      speechAudio ? 16000 : rate,
    );
    chunks.current = [];
    if (blob.current.size > 6 * 1024 * 1024) {
      blob.current = null;
      setError("录音过大，请缩短后重试");
      setState("idle");
      return;
    }
    URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(blob.current);
    setAudioUrl(url.current);
    setState("recorded");
    setLevel(0);
    void transcribe();
  };
  const discard = () => {
    setError("");
    release();
    chunks.current = [];
    blob.current = null;
    samples.current = 0;
    URL.revokeObjectURL(url.current);
    url.current = "";
    setAudioUrl("");
    setTranscript("");
    setSeconds(0);
    setLevel(0);
    setState("idle");
  };
  const start = async () => {
    if (recording.current || inFlight.current || resources.current.stream)
      return;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
      setError("当前浏览器不支持录音，请改用新版浏览器或文字回答");
      return;
    }
    setError("");
    setNotice("");
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      resources.current.stream = stream;
      const context = new AudioContext({ sampleRate: 16000 });
      resources.current.context = context;
      await context.audioWorklet.addModule("/voice-recorder.js");
      if (!mounted.current) {
        release();
        return;
      }
      await context.resume();
      try {
        const creation = import("./voice-activity").then(({ VoiceActivity }) =>
          VoiceActivity.create(
            context.sampleRate,
            () => {
              speechDetected.current = true;
            },
            (audio) => {
              if (recording.current) stop(audio);
            },
            () => {
              if (!mounted.current || !recording.current) return;
              const failed = resources.current.vad;
              resources.current.vad = undefined;
              void failed?.destroy().catch(() => {});
              setError("语音活动检测暂不可用，可手动结束录音");
            },
          ),
        );
        let abandoned = false;
        let timeout: number | undefined;
        const guarded = creation.then((vad) => {
          if (abandoned) {
            void vad.destroy().catch(() => {});
            throw new Error("VAD loading expired");
          }
          return vad;
        });
        let vad: VoiceActivity;
        try {
          vad = await Promise.race([
            guarded,
            new Promise<never>((_, reject) => {
              timeout = window.setTimeout(() => {
                abandoned = true;
                reject(new Error("VAD loading timed out"));
              }, 15000);
            }),
          ]);
        } finally {
          window.clearTimeout(timeout);
        }
        if (!mounted.current) {
          await vad.destroy();
          release();
          return;
        }
        resources.current.vad = vad;
      } catch {
        if (!mounted.current) {
          release();
          return;
        }
        setError("语音活动检测加载失败，可手动结束录音");
      }
      const node = new AudioWorkletNode(context, "voice-recorder");
      resources.current.node = node;
      chunks.current = [];
      samples.current = 0;
      speechDetected.current = false;
      recording.current = true;
      node.port.onmessage = (event) => {
        if (!recording.current) return;
        const chunk = event.data as Float32Array;
        const allowed = Math.max(
          0,
          Math.min(chunk.length, context.sampleRate * 180 - samples.current),
        );
        if (allowed) {
          chunks.current.push(chunk.slice(0, allowed));
          samples.current += allowed;
        }
        const rms = Math.sqrt(
          chunk.reduce((sum, value) => sum + value * value, 0) / chunk.length,
        );
        setLevel(Math.min(100, rms * 400));
        resources.current.vad?.feed(chunk.slice(0, allowed));
        if (samples.current >= context.sampleRate * 180) stop();
      };
      context.createMediaStreamSource(stream).connect(node);
      const mute = context.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(context.destination);
      const started = performance.now();
      resources.current.timer = window.setInterval(() => {
        setSeconds(Math.floor((performance.now() - started) / 1000));
        if (
          resources.current.vad &&
          !speechDetected.current &&
          performance.now() - started >= 10000
        ) {
          discard();
          setError("未检测到语音，请检查麦克风后重新录音");
          return;
        }
        if (performance.now() - started >= 180000) stop();
      }, 250);
      setSeconds(0);
      setState("recording");
    } catch (cause) {
      release();
      if (!mounted.current) return;
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "麦克风权限未允许，请在浏览器中允许后重试"
          : "无法启动麦克风，请检查设备后重试",
      );
      setState("idle");
    }
  };
  const transcribe = async () => {
    if (!blob.current || inFlight.current) return;
    inFlight.current = true;
    setError("");
    setState("transcribing");
    try {
      const result = await upload<{ text: string }>(
        "/trainings/" + trainingId + "/transcribe",
        blob.current,
        "answer.wav",
        { turnId },
      );
      if (mounted.current) {
        const text = result.text.trim();
        if (!text) throw new Error("没有识别到语音，请重新录音");
        if (
          text.length > current.current.remaining ||
          current.current.disabled
        ) {
          setTranscript(text);
          setError("转写已保留，当前回答无法容纳全文，请缩短后加入");
        } else {
          current.current.onAppend(text);
          discard();
          setNotice("语音已填入回答");
        }
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "转写失败，可重试");
    } finally {
      inFlight.current = false;
      if (mounted.current && blob.current) setState("recorded");
    }
  };
  const active = ["requesting", "recording", "transcribing"].includes(state);
  return (
    <div className="voice-input">
      <div className="input-tool-heading">
        <span>
          <Mic size={16} />
          语音回答
        </span>
        {state === "idle" && (
          <button
            type="button"
            className="icon-button"
            title="开始录音（云端语音转写）"
            aria-label="开始录音"
            disabled={disabled || !enabled}
            onClick={() => void start()}
          >
            <Mic size={16} />
          </button>
        )}
        {state === "requesting" && (
          <span role="status">
            <LoaderCircle className="spin" size={16} />
            正在连接麦克风
          </span>
        )}
        {state === "recording" && (
          <button
            type="button"
            className="icon-button recording-button"
            title="结束录音"
            aria-label="结束录音"
            onClick={() => stop()}
          >
            <Square size={15} />
          </button>
        )}
      </div>
      {notice && (
        <p className="input-status" role="status">
          {notice}
        </p>
      )}
      {enabled === false && <p className="input-status">语音识别暂不可用</p>}
      {state === "recording" && (
        <div className="recording-status" role="status">
          <span className="recording-dot" />
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} /
          3:00
          <div className="audio-meter">
            <span style={{ width: level + "%" }} />
          </div>
          <button
            type="button"
            className="icon-button"
            title="取消录音"
            aria-label="取消录音"
            onClick={discard}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {audioUrl && (
        <div className="recorded-audio">
          <audio controls src={audioUrl} />
          <div className="input-tool-actions">
            <button
              type="button"
              className="icon-button"
              disabled={active || disabled}
              title="重试转写"
              aria-label="重试转写"
              onClick={() => void transcribe()}
            >
              {state === "transcribing" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FileText size={16} />
              )}
            </button>
            <button
              type="button"
              className="icon-button"
              title="丢弃并重录"
              aria-label="丢弃并重录"
              disabled={active}
              onClick={discard}
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>
      )}
      {state === "transcribing" && (
        <p className="input-status" role="status">
          正在转写
        </p>
      )}
      {transcript && (
        <div className="transcript-preview">
          <label>
            转写结果
            <textarea
              aria-label="语音转写结果"
              value={transcript}
              maxLength={6000}
              rows={4}
              onChange={(event) => setTranscript(event.target.value)}
            />
          </label>
          <div className="input-tool-actions">
            <small>{transcript.length} 字</small>
            <button
              type="button"
              className="button secondary"
              disabled={
                active ||
                disabled ||
                !transcript.trim() ||
                transcript.trim().length > remaining
              }
              onClick={() => {
                current.current.onAppend(transcript.trim());
                discard();
              }}
            >
              <Plus size={16} />
              加入回答
            </button>
          </div>
          {transcript.trim().length > remaining && (
            <p role="alert" className="action-error">
              合并后超过6000字，请缩短转写或已有回答
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="action-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

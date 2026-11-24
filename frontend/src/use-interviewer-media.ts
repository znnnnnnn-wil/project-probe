import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "./api";

type SpeechTarget = { endpoint: string } & (
  { turnId: string; exchangeCount?: number } | { sentence: string; speechTicket: string }
);
type SpeechDone = (played: boolean) => void;
const CLOUD_START_TIMEOUT = 9000;
const BROWSER_START_TIMEOUT = 5000;

export function useQuestionSpeech(ttsEnabled = false) {
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [playbackNotice, setPlaybackNotice] = useState("");
  // -1 表示当前没有云端音频分析，口型退回程序化动画。
  const mouthLevel = useRef(-1);
  const speechId = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);
  const release = useRef<(() => void) | null>(null);
  const startTimer = useRef<number | undefined>(undefined);
  const browserSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const supported = ttsEnabled || browserSupported;
  const stop = useCallback(() => {
    speechId.current++;
    release.current?.();
    release.current = null;
    window.clearTimeout(startTimer.current);
    mouthLevel.current = -1;
    if (browserSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setPreparing(false);
  }, [browserSupported]);
  const finish = useCallback((id: number) => {
    if (id !== speechId.current) return;
    stop();
  }, [stop]);
  const startPlayback = useCallback((id: number) => {
    if (id !== speechId.current) return;
    window.clearTimeout(startTimer.current);
    setPreparing(false);
    setSpeaking(true);
  }, []);
  const unlock = useCallback(() => {
    if (typeof AudioContext === "undefined") return;
    try {
      const context = audioContext.current ?? (audioContext.current = new AudioContext());
      void context.resume().catch(() => {});
    } catch {
      // Playback can still use the browser speech synthesizer.
    }
  }, []);
  const browserSpeak = useCallback(
    (text: string, id: number, done: SpeechDone) => {
      if (!browserSupported) {
        done(false);
        return;
      }
      let settled = false;
      const complete = (played: boolean) => {
        if (id !== speechId.current || settled) return;
        settled = true;
        window.clearTimeout(startTimer.current);
        done(played);
      };
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 0.94;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(
          (voice) =>
            voice.lang.startsWith("zh") &&
            /Yunxi|Yunyang|Male|云希|云扬/.test(voice.name),
        ) || voices.find((voice) => voice.lang.startsWith("zh"));
      if (preferred) utterance.voice = preferred;
      utterance.onstart = () => startPlayback(id);
      utterance.onend = () => complete(true);
      utterance.onerror = () => complete(false);
      startTimer.current = window.setTimeout(() => {
        utterance.onstart = utterance.onend = utterance.onerror = null;
        window.speechSynthesis.cancel();
        complete(false);
      }, BROWSER_START_TIMEOUT);
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        complete(false);
      }
    },
    [browserSupported, startPlayback],
  );
  const cloudSpeak = useCallback(
    async (target: SpeechTarget, id: number, done: (played: boolean, reason?: string) => void) => {
      const controller = new AbortController();
      const audio = new Audio();
      const active = () => id === speechId.current && !controller.signal.aborted;
      let objectUrl = "";
      let source: MediaElementAudioSourceNode | null = null;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let frame = 0;
      let played = false;
      const cleanup = () => {
        if (controller.signal.aborted) return;
        controller.abort();
        void reader?.cancel().catch(() => {});
        cancelAnimationFrame(frame);
        audio.pause();
        audio.removeAttribute("src");
        try {
          audio.load();
        } catch {}
        source?.disconnect();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (id === speechId.current) mouthLevel.current = -1;
      };
      const complete = (reason?: string) => {
        if (!active()) return;
        window.clearTimeout(startTimer.current);
        release.current = null;
        cleanup();
        done(played, reason);
      };
      release.current = cleanup;
      startTimer.current = window.setTimeout(() => complete("first_audio_timeout"), CLOUD_START_TIMEOUT);
      try {
        if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported("audio/mpeg")) {
          complete("unsupported_audio_stream");
          return;
        }
        const { endpoint, ...payload } = target;
        const response = await fetchApi(
          endpoint + "/tts",
          {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok || !response.body) {
          complete(response.ok ? "empty_response" : "http_" + response.status);
          return;
        }
        if (!active()) return;
        const mediaSource = new MediaSource();
        objectUrl = URL.createObjectURL(mediaSource);
        await new Promise<void>((resolve, reject) => {
          const removeListeners = () => {
            mediaSource.removeEventListener("sourceopen", opened);
            audio.removeEventListener("error", failed);
            controller.signal.removeEventListener("abort", aborted);
          };
          const opened = () => { removeListeners(); resolve(); };
          const failed = () => { removeListeners(); reject(new Error("audio")); };
          const aborted = () => { removeListeners(); reject(controller.signal.reason); };
          mediaSource.addEventListener("sourceopen", opened, { once: true });
          audio.addEventListener("error", failed, { once: true });
          controller.signal.addEventListener("abort", aborted, { once: true });
          audio.src = objectUrl;
        });
        if (!active()) return;
        const buffer = mediaSource.addSourceBuffer("audio/mpeg");
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let appending = false;
        let streamDone = false;
        const pump = () => {
          if (!active() || mediaSource.readyState !== "open" || appending || buffer.updating) return;
          const next = chunks.shift();
          if (next) {
            appending = true;
            buffer.appendBuffer(next);
          } else if (streamDone && mediaSource.readyState === "open") {
            try {
              mediaSource.endOfStream();
            } catch {}
          }
        };
        buffer.addEventListener("updateend", () => {
          appending = false;
          try { pump(); } catch { complete("audio_buffer_error"); }
        }, { signal: controller.signal });
        const Context =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const context =
          audioContext.current ?? (audioContext.current = new Context());
        await context.resume();
        if (!active()) return;
        source = context.createMediaElementSource(audio);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyser.connect(context.destination);
        const samples = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (!active()) return;
          frame = requestAnimationFrame(tick);
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            const value = (samples[i] - 128) / 128;
            sum += value * value;
          }
          const level = Math.min(1, Math.sqrt(sum / samples.length) * 5);
          mouthLevel.current += (level - mouthLevel.current) * 0.45;
        };
        mouthLevel.current = 0;
        audio.addEventListener(
          "playing",
          () => {
            if (!active()) return;
            played = true;
            startPlayback(id);
            tick();
          },
          { once: true, signal: controller.signal },
        );
        audio.addEventListener("ended", () => complete(played ? undefined : "empty_audio"), { once: true, signal: controller.signal });
        audio.addEventListener("error", () => complete("audio_decode_error"), { once: true, signal: controller.signal });
        const audioReader = response.body.getReader();
        reader = audioReader;
        void (async () => {
          try {
            while (true) {
              const { done, value } = await audioReader.read();
              if (!active()) return;
              if (done) break;
              chunks.push(value as Uint8Array<ArrayBuffer>);
              pump();
            }
          } catch {
            complete("audio_stream_error");
            return;
          } finally {
            reader = undefined;
            audioReader.releaseLock();
          }
          if (!active()) return;
          streamDone = true;
          try { pump(); } catch { complete("audio_buffer_error"); }
        })();
        await audio.play();
      } catch {
        complete("connection_or_playback_error");
      }
    },
    [startPlayback],
  );
  const noticeFailure = useCallback((reason: string, played: boolean, hasFallback: boolean) => {
    console.warn("interview_tts_failed", { reason, stage: played ? "during_playback" : "before_playback" });
    setPlaybackNotice(played ? "面试官播报中断，可以点击重新播报。" : hasFallback
      ? "云端播报暂不可用，已切换到浏览器朗读。"
      : "面试官语音暂不可用，可以查看文字或点击重新播报。");
  }, []);
  const speak = useCallback(
    (text: string, target?: SpeechTarget) => {
      stop();
      if (!text.trim() || !supported) return;
      const id = speechId.current;
      setPlaybackNotice("");
      setPreparing(true);
      const done = (played: boolean) => {
        if (!played) setPlaybackNotice("面试官语音暂不可用，可以查看文字或点击重新播报。");
        finish(id);
      };
      if (ttsEnabled && target) void cloudSpeak(target, id, (played, reason) => {
        if (reason) noticeFailure(reason, played, browserSupported);
        if (reason && !played && browserSupported) browserSpeak(text, id, done);
        else finish(id);
      });
      else browserSpeak(text, id, done);
    },
    [stop, supported, ttsEnabled, cloudSpeak, browserSpeak, browserSupported, finish, noticeFailure],
  );
  const beginSpeechStream = useCallback((endpoint: string) => {
    const queue: { sentence: string; speechTicket?: string }[] = [];
    let id: number | undefined;
    let playing = false;
    let ended = false;
    let useBrowser = !ttsEnabled;
    const playNext = () => {
      if (id === undefined || id !== speechId.current || playing) return;
      const next = queue.shift();
      if (!next) {
        if (ended) finish(id);
        else { setSpeaking(false); setPreparing(false); }
        return;
      }
      const playbackId = id;
      playing = true;
      setPreparing(true);
      const done = () => { playing = false; playNext(); };
      const playLocally = () => browserSpeak(next.sentence, playbackId, played => {
        if (!played) setPlaybackNotice("面试官语音暂不可用，可以查看文字或点击重新播报。");
        done();
      });
      if (useBrowser || !next.speechTicket) {
        playLocally();
        return;
      }
      void cloudSpeak({ endpoint, sentence: next.sentence, speechTicket: next.speechTicket }, playbackId, (played, reason) => {
        if (reason) noticeFailure(reason, played, browserSupported);
        if (reason && !played && browserSupported) {
          useBrowser = true;
          playLocally();
        } else done();
      });
    };
    return {
      write(sentence: string, speechTicket?: string) {
        if ((!browserSupported && (!ttsEnabled || !speechTicket)) || ended ||
            (id !== undefined && id !== speechId.current)) return;
        if (id === undefined) {
          stop();
          id = speechId.current;
          setPlaybackNotice("");
        }
        queue.push({ sentence, speechTicket });
        playNext();
      },
      end() {
        const queued = id !== undefined && id === speechId.current;
        ended = true;
        playNext();
        return queued;
      },
      cancel() { ended = true; queue.length = 0; if (id !== undefined) finish(id); },
    };
  }, [browserSupported, stop, finish, ttsEnabled, browserSpeak, cloudSpeak, noticeFailure]);
  useEffect(
    () => () => {
      stop();
      void audioContext.current?.close();
      audioContext.current = null;
    },
    [stop],
  );
  return { preparing, speaking, speak, stop, unlock, supported, mouthLevel, beginSpeechStream, playbackNotice };
}

export function useCameraPreview() {
  const [on, setOn] = useState(false);
  const [error, setError] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (mounted.current) {
      setStream(null);
      setOn(false);
    }
  }, []);
  const toggle = useCallback(async () => {
    if (pending.current) return;
    if (streamRef.current) {
      stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器无法打开摄像头，可继续语音或文字训练");
      return;
    }
    pending.current = true;
    setError("");
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 320, facingMode: "user" },
        audio: false,
      });
      if (!mounted.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = next;
      setStream(next);
      setOn(true);
    } catch {
      if (mounted.current)
        setError("摄像头未开启，可以继续使用语音或文字训练");
    } finally {
      pending.current = false;
    }
  }, [stop]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);
  return { on, error, stream, toggle, stop };
}

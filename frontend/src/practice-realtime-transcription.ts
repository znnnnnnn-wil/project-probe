import { apiUrl } from "./api";

type RealtimeResult = { text: string } | { reason: string };
const CONNECT_TIMEOUT = 4200;
const FINAL_TEXT_TIMEOUT = 3200;

export function openRealtimeTranscription(endpoint: string, turnId: string, exchangeCount: number) {
  const url = apiUrl(endpoint + "/transcribe-stream");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ turnId, exchangeCount: String(exchangeCount) }).toString();
  const socket = new WebSocket(url);
  let ready = false;
  let finished = false;
  let closed = false;
  let result: (value: RealtimeResult) => void;
  let deadline: number | undefined;
  const chunks: Int16Array[] = [];
  let sampleCount = 0;
  const finalText = new Promise<RealtimeResult>(resolve => { result = resolve; });

  const close = (value: RealtimeResult) => {
    if (closed) return;
    closed = true;
    window.clearTimeout(deadline);
    chunks.length = 0;
    result(value);
    if (socket.readyState <= WebSocket.OPEN) socket.close();
  };
  const waitForFinalText = () => {
    deadline = window.setTimeout(() => close({ reason: "final_text_timeout" }), FINAL_TEXT_TIMEOUT);
  };

  const sendAudio = () => {
    if (!ready || closed || !sampleCount) return;
    if (socket.bufferedAmount > 96_000) { close({ reason: "audio_buffer_full" }); return; }
    const pcm = new Int16Array(sampleCount);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    for (let start = 0; start < pcm.length; start += 3200) socket.send(pcm.slice(start, start + 3200));
    chunks.length = 0;
    sampleCount = 0;
  };

  socket.addEventListener("message", event => {
    if (closed || typeof event.data !== "string") return;
    try {
      const message = JSON.parse(event.data) as { ready?: boolean; text?: string };
      if (message.ready && !ready) {
        ready = true;
        window.clearTimeout(deadline);
        sendAudio();
        if (finished && !closed) {
          socket.send("finish");
          waitForFinalText();
        }
      } else if (finished && typeof message.text === "string") {
        const text = message.text.trim();
        close(text ? { text } : { reason: "empty_transcript" });
      }
    } catch { close({ reason: "stream_protocol_error" }); }
  });
  socket.addEventListener("error", () => close({ reason: "socket_error" }));
  socket.addEventListener("close", () => close({ reason: ready ? "stream_closed" : "connection_closed" }));
  deadline = window.setTimeout(() => close({ reason: "connection_timeout" }), CONNECT_TIMEOUT);

  return {
    push(samples: Float32Array) {
      if (closed || finished || !samples.length) return;
      const chunk = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        chunk[i] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      chunks.push(chunk);
      sampleCount += chunk.length;
      if (sampleCount > 80_000) close({ reason: "audio_buffer_full" });
      else if (sampleCount >= 1600) {
        try { sendAudio(); } catch { close({ reason: "audio_send_error" }); }
      }
    },
    finish() {
      if (!finished && !closed) {
        finished = true;
        try {
          if (ready) {
            sendAudio();
            if (!closed) { socket.send("finish"); waitForFinalText(); }
          }
        } catch { close({ reason: "audio_send_error" }); }
      }
      return finalText;
    },
    abort: () => close({ reason: "cancelled" }),
  };
}

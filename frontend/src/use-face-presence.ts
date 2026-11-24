import { useEffect, useRef, useState } from "react";

export type FacePresence = {
  ready: boolean;
  face: boolean;
  speaking: boolean;
  yaw: number;
  pitch: number;
  nodAt: number;
};

const idle: FacePresence = {
  ready: false,
  face: false,
  speaking: false,
  yaw: 0,
  pitch: 0,
  nodAt: 0,
};

// MediaPipe 默认向 Google 上报用量遥测且无公开开关；本产品承诺画面与使用数据不出本机。
let telemetryBlocked = false;
function blockMediaPipeTelemetry() {
  if (telemetryBlocked) return;
  telemetryBlocked = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("https://odml.pa.googleapis.com/"))
      return Promise.reject(
        new DOMException("Blocked MediaPipe telemetry", "AbortError"),
      );
    return original(input, init);
  };
}

export function useFacePresence(stream: MediaStream | null) {
  const presence = useRef<FacePresence>({ ...idle });
  const [snapshot, setSnapshot] = useState({
    ready: false,
    face: false,
    speaking: false,
  });
  useEffect(() => {
    const state = presence.current;
    Object.assign(state, idle);
    setSnapshot({ ready: false, face: false, speaking: false });
    if (!stream) return;
    blockMediaPipeTelemetry();
    let disposed = false;
    let frame = 0;
    const cleanups: (() => void)[] = [];
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const publish = () => {
      setSnapshot((previous) =>
        previous.ready === state.ready &&
        previous.face === state.face &&
        previous.speaking === state.speaking
          ? previous
          : { ready: state.ready, face: state.face, speaking: state.speaking },
      );
    };
    void (async () => {
      await video.play().catch(() => {});
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(
        "/mediapipe-wasm",
      );
      if (disposed) return;
      const landmarker = await vision.FaceLandmarker.createFromOptions(
        fileset,
        {
          baseOptions: {
            modelAssetPath: "/models/face_landmarker.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        },
      );
      if (disposed) {
        landmarker.close();
        return;
      }
      cleanups.push(() => landmarker.close());
      state.ready = true;
      publish();
      let last = 0;
      let jaw = 0;
      let speakStart = 0;
      let wasSpeaking = false;
      const loop = (time: number) => {
        frame = requestAnimationFrame(loop);
        if (disposed || document.hidden || video.readyState < 2) return;
        if (time - last < 80) return;
        last = time;
        const result = landmarker.detectForVideo(video, time);
        const shapes = result.faceBlendshapes?.[0]?.categories;
        const matrix = result.facialTransformationMatrixes?.[0]?.data;
        if (!shapes || !matrix) {
          state.face = false;
          state.speaking = false;
          wasSpeaking = false;
          publish();
          return;
        }
        state.face = true;
        const score = (name: string) =>
          shapes.find((category) => category.categoryName === name)?.score ?? 0;
        jaw += (score("jawOpen") - jaw) * 0.5;
        const speakingNow = jaw > 0.22;
        if (speakingNow && !wasSpeaking) speakStart = time;
        if (!speakingNow && wasSpeaking && time - speakStart > 600)
          state.nodAt = time;
        wasSpeaking = speakingNow;
        state.speaking = speakingNow;
        state.yaw = Math.atan2(matrix[8], matrix[10]);
        state.pitch = Math.atan2(-matrix[9], Math.hypot(matrix[8], matrix[10]));
        publish();
      };
      frame = requestAnimationFrame(loop);
      cleanups.push(() => cancelAnimationFrame(frame));
    })().catch(() => {
      state.ready = false;
      publish();
    });
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
      video.pause();
      video.srcObject = null;
      Object.assign(state, idle);
    };
  }, [stream]);
  return { presence, snapshot };
}
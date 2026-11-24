import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { loadInterviewerRig, type AvatarState } from "./interviewer-rig";
import type { FacePresence } from "./use-face-presence";
import "./interviewer.css";

const PORTRAIT_URL = "/models/interviewer-v2-portrait.webp";

export function InterviewerAvatar({
  state = "idle",
  label = "虚拟面试官陈老师",
  mouthLevel,
  presence,
}: {
  state?: AvatarState;
  label?: string;
  mouthLevel?: { current: number };
  presence?: { current: FacePresence };
}) {
  const mount = useRef<HTMLDivElement>(null);
  const latest = useRef({ state, mouthLevel, presence });
  latest.current = { state, mouthLevel, presence };
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const release = () => cleanups.splice(0).reverse().forEach(fn => fn());
    void (async () => {
      const THREE = await import("three");
      if (disposed) return;
      const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      cleanups.push(() => {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.92;
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
      // A small studio environment gives eyes and skin soft reflections without
      // downloading an HDR image or flattening the face with strong ambient light.
      const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
      if (disposed) return;
      const studio = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const environment = pmrem.fromScene(studio, 0.04);
      studio.dispose();
      pmrem.dispose();
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.3;
      cleanups.push(() => environment.dispose());
      scene.add(new THREE.HemisphereLight(0xfffaf5, 0x72786d, 0.4));
      const key = new THREE.DirectionalLight(0xfff4eb, 2.1);
      key.position.set(-2.2, 3.2, 3.5);
      key.target.position.set(0, 1.3, 0);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -0.8;
      key.shadow.camera.right = 0.8;
      key.shadow.camera.top = 0.8;
      key.shadow.camera.bottom = -0.8;
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 7;
      key.shadow.normalBias = 0.003;
      key.shadow.bias = -0.0002;
      scene.add(key);
      scene.add(key.target);
      cleanups.push(() => key.shadow.dispose());
      const fill = new THREE.DirectionalLight(0xf0f4f5, 0.4);
      fill.position.set(2, 1.8, 3);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xffebce, 1.1);
      rim.position.set(1, 2.6, -1.6);
      scene.add(rim);

      const rig = await loadInterviewerRig();
      if (disposed) {
        rig.dispose();
        return;
      }
      cleanups.push(rig.dispose);
      scene.add(rig.root);
      host.append(renderer.domElement);
      const resize = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        // Fit the portrait by visible height, rather than a fixed distance: a
        // tall login panel and a wide mobile stage need different headroom.
        const wide = THREE.MathUtils.clamp((camera.aspect - 0.7) / 1.1, 0, 1);
        const portraitHeight = Math.max(THREE.MathUtils.lerp(0.79, 0.51, wide), 0.48 / camera.aspect) * rig.scale;
        const distance = portraitHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
        const targetY = rig.headTop + 0.055 * rig.scale - portraitHeight / 2;
        camera.position.set(rig.headPosition.x + 0.015 * rig.scale, targetY + 0.012 * rig.scale, rig.headPosition.z + distance);
        camera.lookAt(rig.headPosition.x, targetY, rig.headPosition.z);
        camera.updateProjectionMatrix();
        if (reduceMotion) renderer.render(scene, camera);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      cleanups.push(() => observer.disconnect());
      resize();

      const input = () => {
        const current = latest.current;
        return {
          state: current.state,
          mouthLevel: current.mouthLevel?.current ?? -1,
          presence: current.presence?.current,
        };
      };
      if (reduceMotion) {
        rig.update({ ...input(), time: 0, dt: 1 });
        renderer.render(scene, camera);
      } else {
        let visible = true;
        const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
        visibility.observe(host);
        cleanups.push(() => visibility.disconnect());
        const started = performance.now();
        let previous = started;
        let frame = 0;
        const animate = (now: number) => {
          frame = requestAnimationFrame(animate);
          if (document.hidden || !visible || !host.isConnected) return;
          const dt = Math.min(0.05, (now - previous) / 1000);
          if (dt < 1 / 40) return;
          previous = now;
          rig.update({ ...input(), time: (now - started) / 1000, dt });
          renderer.render(scene, camera);
        };
        frame = requestAnimationFrame(animate);
        cleanups.push(() => cancelAnimationFrame(frame));
      }
      if (!disposed) setStatus("ready");
    })().catch(error => {
      console.error("Interviewer avatar:", error);
      release();
      if (!disposed) setStatus("error");
    });
    return () => {
      disposed = true;
      release();
    };
  }, []);

  return (
    <div className="avatar-shell" role="img" aria-label={label} data-avatar-state={state} data-avatar-status={status}>
      <img
        className={status === "ready" ? "avatar-portrait is-hidden" : "avatar-portrait"}
        src={PORTRAIT_URL}
        alt=""
      />
      <div className={status === "ready" ? "avatar-mount is-ready" : "avatar-mount"} ref={mount} />
      {status === "loading" && (
        <div className="avatar-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          正在准备 3D 面试官
        </div>
      )}
    </div>
  );
}

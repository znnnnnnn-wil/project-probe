import type { FacePresence } from "./use-face-presence";
import { prepareInterviewerMaterials } from "./interviewer-materials";
import { addInterviewerGlasses } from "./interviewer-accessories";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

export type RigInput = {
  state: AvatarState;
  mouthLevel: number;
  presence?: FacePresence;
  time: number;
  dt: number;
};

export type InterviewerRig = {
  root: import("three").Object3D;
  headPosition: import("three").Vector3;
  headTop: number;
  scale: number;
  update: (input: RigInput) => void;
  dispose: () => void;
};

const MODEL_URL = "/models/interviewer-v2.glb";
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
// 闭睑快、睁睑慢，并带短暂停留，避免对称正弦的机械感。
const blinkCurve = (age: number) => {
  if (age < 0 || age > 0.28) return 0;
  if (age < 0.07) return (age / 0.07) * (age / 0.07);
  if (age < 0.11) return 1;
  return 1 - easeOutCubic((age - 0.11) / 0.17);
};
const damp = (current: number, target: number, tau: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-dt / tau));

export async function loadInterviewerRig(): Promise<InterviewerRig> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const root = gltf.scene;
  const disposeMaterials = prepareInterviewerMaterials(THREE, root);
  root.updateMatrixWorld(true);

  // GLTFLoader 会清洗节点名（去掉冒号），三种写法都试。
  const bone = (name: string) =>
    root.getObjectByName("mixamorig" + name) ||
    root.getObjectByName("mixamorig:" + name) ||
    root.getObjectByName(name);
  const hips = bone("Hips");
  const spine1 = bone("Spine1");
  const spine2 = bone("Spine2");
  const neck = bone("Neck");
  const head = bone("Head");
  const shoulders = [bone("LeftShoulder"), bone("RightShoulder")];
  const forearms = [bone("LeftForeArm"), bone("RightForeArm")];
  addInterviewerGlasses(THREE, root, head);

  // 放松垂臂：把 T-pose 的上臂旋到自然下垂方向。
  for (const side of ["Left", "Right"]) {
    const upperArm = bone(side + "Arm");
    const forearm = bone(side + "ForeArm");
    if (!upperArm || !forearm) continue;
    const shoulder = upperArm.getWorldPosition(new THREE.Vector3());
    const elbow = forearm.getWorldPosition(new THREE.Vector3());
    const current = elbow.sub(shoulder).normalize();
    const relaxed = new THREE.Vector3(Math.sign(current.x) * 0.16, -1, 0.1).normalize();
    const adjustment = new THREE.Quaternion().setFromUnitVectors(current, relaxed);
    const parentWorld = upperArm.parent!.getWorldQuaternion(new THREE.Quaternion());
    const armWorld = upperArm.getWorldQuaternion(new THREE.Quaternion());
    upperArm.quaternion.copy(parentWorld.invert().multiply(adjustment).multiply(armWorld));
    upperArm.updateWorldMatrix(false, true);
  }
  root.updateMatrixWorld(true);

  const base = new Map<import("three").Object3D, import("three").Euler>();
  for (const node of [hips, spine1, spine2, neck, head, ...shoulders, ...forearms]) {
    if (node) base.set(node, node.rotation.clone());
  }
  const morphs: { dict: Record<string, number>; values: number[] }[] = [];
  const teeth: import("three").Mesh[] = [];
  root.traverse(object => {
    const mesh = object as import("three").Mesh;
    if (!mesh.isMesh) return;
    if (/^teeth/.test(mesh.name)) teeth.push(mesh);
    // 舌头网格在开口时会凸出下唇，口腔内壁已足够表现开口内部。
    if (/^tongue/.test(mesh.name)) mesh.visible = false;
    mesh.frustumCulled = false;
    if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      morphs.push({ dict: mesh.morphTargetDictionary, values: mesh.morphTargetInfluences });
    }
  });
  const morph = (name: string, value: number) => {
    for (const entry of morphs) {
      const index = entry.dict[name];
      if (index !== undefined) entry.values[index] = value;
    }
  };

  const headPosition = new THREE.Vector3();
  const bounds = new THREE.Box3().setFromObject(root);
  const headTop = bounds.max.y;
  const scale = bounds.getSize(new THREE.Vector3()).y / 1.7;
  const hipsY = hips?.position.y ?? 0;
  if (head) head.getWorldPosition(headPosition);
  else {
    const box = new THREE.Box3().setFromObject(root);
    headPosition.set(0, box.max.y - 0.12, 0);
  }

  let nextBlink = 1.6 + Math.random() * 2;
  let blinkAt = -10;
  let blinkAmp = 1;
  let blinkOffset = 0;
  let doubleBlink = false;
  let nextGaze = 2;
  let gazeYaw = 0;
  let gazePitch = 0;
  let nextNod = 4;
  let nodAt = -10;
  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let lean = 0;
  let smile = 0.1;
  let squint = 0.03;
  let jaw = 0;
  let funnel = 0;
  let emphasis = 0;
  let previousLevel = 0;
  let brow = 0;
  let pucker = 0;
  let stretch = 0;

  const update = ({ state, mouthLevel, presence, time, dt }: RigInput) => {
    const speaking = state === "speaking";
    const listening = state === "listening";
    const thinking = state === "thinking";
    const seen = presence;
    const engaged = !!seen?.ready && seen.face;

    if (time >= nextBlink) {
      blinkAt = time;
      blinkAmp = Math.random() < 0.16 ? 0.45 + Math.random() * 0.3 : 0.88 + Math.random() * 0.12;
      blinkOffset = Math.random() * 0.024;
      doubleBlink = Math.random() < 0.12;
      nextBlink = time + (speaking ? 1.9 : 2.4) + Math.random() * 3.4;
    }
    let blinkL = blinkCurve(time - blinkAt) * blinkAmp;
    let blinkR = blinkCurve(time - blinkAt - blinkOffset) * blinkAmp;
    if (doubleBlink) {
      blinkL = Math.max(blinkL, blinkCurve(time - blinkAt - 0.34) * blinkAmp);
      blinkR = Math.max(blinkR, blinkCurve(time - blinkAt - 0.34 - blinkOffset) * blinkAmp);
    }
    const blink = Math.max(blinkL, blinkR);

    if (time >= nextGaze) {
      nextGaze = time + 1.8 + Math.random() * 2.8;
      if (thinking) {
        gazeYaw = 0.07 + Math.random() * 0.04;
        gazePitch = -0.06 - Math.random() * 0.03;
      } else if (engaged || listening) {
        gazeYaw = (Math.random() - 0.5) * 0.03;
        gazePitch = (Math.random() - 0.5) * 0.02;
      } else {
        gazeYaw = (Math.random() - 0.5) * 0.07;
        gazePitch = (Math.random() - 0.5) * 0.04;
      }
    }
    const lookYaw = engaged ? clamp(-seen!.yaw * 0.35, -0.16, 0.16) : gazeYaw;
    const lookPitch = engaged ? clamp(seen!.pitch * 0.2, -0.06, 0.06) : gazePitch;
    yaw = damp(yaw, lookYaw, thinking ? 0.4 : 0.16, dt);
    pitch = damp(pitch, lookPitch, thinking ? 0.4 : 0.16, dt);
    roll = damp(roll, thinking ? 0.03 : engaged ? 0.008 : 0, 0.5, dt);
    lean = damp(lean, listening ? 0.03 : thinking ? -0.012 : 0, 0.45, dt);

    if (seen?.nodAt && time - nodAt > 0.9) {
      const age = (performance.now() - seen.nodAt) / 1000;
      if (age >= 0 && age < 0.9) nodAt = time;
    }
    if (listening && seen?.speaking && time >= nextNod) {
      nodAt = time;
      nextNod = time + 3.2 + Math.random() * 3;
    }
    const nodAge = time - nodAt;
    const nod = nodAge >= 0 && nodAge < 0.85
      ? Math.sin((nodAge / 0.85) * Math.PI * 2) * 0.05 * (1 - nodAge / 0.85)
      : 0;

    const audioDriven = mouthLevel >= 0;
    const syllable = Math.max(0, Math.sin(time * 10.7)) * 0.6 + Math.max(0, Math.sin(time * 6.3 + 1.2)) * 0.4;
    const gate = 0.55 + 0.45 * Math.sin(time * 2.2 + Math.sin(time * 0.9));
    const targetJaw = speaking
      ? clamp(audioDriven ? Math.pow(clamp(mouthLevel, 0, 1), 0.85) : syllable * gate, 0, 1) * 0.38
      : 0;
    jaw = damp(jaw, targetJaw, targetJaw > jaw ? 0.045 : 0.11, dt);
    if (speaking && jaw - previousLevel > 0.06) emphasis = 1;
    previousLevel = jaw;
    emphasis = damp(emphasis, 0, 0.22, dt);
    const rounded = 0.5 + 0.5 * Math.sin(time * 5.1 + 1.3);
    funnel = damp(funnel, speaking ? jaw * rounded * 0.24 : 0, 0.09, dt);
    pucker = damp(pucker, speaking ? jaw * rounded * 0.12 : 0, 0.1, dt);
    stretch = damp(stretch, speaking ? jaw * (1 - rounded) * 0.15 : 0, 0.1, dt);
    smile = damp(smile, speaking ? 0.08 + jaw * 0.06 : listening ? 0.16 : thinking ? 0.03 : 0.1, 0.4, dt);
    squint = damp(squint, thinking ? 0.07 : speaking ? 0.025 + jaw * 0.04 : listening ? 0.04 : 0.02, 0.3, dt);
    brow = damp(brow, thinking ? 0.12 : listening ? 0.05 : speaking ? emphasis * 0.09 : 0.02, 0.4, dt);

    const breath = Math.sin(time * 1.35);
    const sway = engaged ? 0.4 : 1;
    const setRot = (node: import("three").Object3D | undefined, x: number, y: number, z: number) => {
      const origin = node && base.get(node);
      if (!node || !origin) return;
      node.rotation.set(origin.x + x, origin.y + y, origin.z + z);
    };
    setRot(hips, 0, 0, Math.sin(time * 0.21) * 0.008 * sway);
    if (hips) hips.position.y = hipsY + breath * 0.0015;
    setRot(spine1, breath * 0.006 + lean * 0.4, Math.sin(time * 0.26) * 0.006 * sway, 0);
    setRot(spine2, breath * 0.005 + lean * 0.5, 0, Math.sin(time * 0.17) * 0.004);
    setRot(neck, pitch * 0.4 + lean * 0.6 + nod * 0.4, yaw * 0.4, roll * 0.4);
    setRot(
      head,
      pitch + lean * 0.4 + nod + emphasis * 0.02 + Math.sin(time * 0.65) * 0.008 * sway,
      yaw + Math.sin(time * 0.38) * 0.014 * sway,
      roll + Math.sin(time * 0.47) * 0.005 * sway,
    );
    shoulders.forEach((shoulder, i) => setRot(shoulder, 0, 0, (i === 0 ? 1 : -1) * breath * 0.006));
    forearms.forEach((forearm, i) => setRot(forearm, Math.sin(time * 0.33 + i * 2.1) * 0.012, 0, 0));

    morph("eyeBlinkLeft", blinkL);
    morph("eyeBlinkRight", blinkR);
    morph("eyeSquintLeft", squint + blink * 0.25);
    morph("eyeSquintRight", squint + blink * 0.25);
    morph("jawOpen", jaw);
    morph("mouthSmile", smile);
    morph("mouthFunnel", clamp(funnel, 0, 0.6));
    morph("mouthPucker", pucker);
    morph("mouthStretch", stretch);
    morph("mouthPress", speaking ? 0 : 0.12);
    morph("mouthDimple", smile * 0.3);
    morph("browInnerUpLeft", brow);
    morph("browInnerUpRight", brow * 0.9);
    morph("browOuterUpLeft", brow * 0.35);
    morph("browOuterUpRight", brow * 0.4);
    // 该模型的 mouthClose 形态反而撑开嘴唇， neutral 姿态即闭口，恒置 0。
    morph("mouthClose", 0);
    // Teeth stay in the mouth and are occluded by the lips, avoiding a visible
    // on/off switch as the jaw crosses a loudness threshold.
    for (const mesh of teeth) mesh.visible = true;
  };

  const dispose = () => {
    disposeMaterials();
    root.traverse(object => {
      const mesh = object as import("three").Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value && (value as import("three").Texture).isTexture) (value as import("three").Texture).dispose();
        }
        material.dispose();
      }
    });
  };

  return { root, headPosition, headTop, scale, update, dispose };
}

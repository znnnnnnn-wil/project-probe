import { HumanAvatar, loadHumanPackage } from "humanforge-runtime";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { MeshStandardMaterial, SkinnedMesh } from "three";

// HumanForge b3e5885 / v0.5.0, MakeHuman and MPFB CC0 assets.
// All 34 genuine facial shapes are retained; the pack has no phoneme visemes.
const config = {
  gender: 1, age: 0.27, weight: 0.52, muscle: 0.48, height: 0.52, proportions: 0.53,
  asian: 0.94, african: 0, caucasian: 0.06,
  skin: "middleage_asian_male", skinTint: "#fff5f2", eyes: "brown",
  eyebrows: "eyebrow010", hair: "short02", hairColor: "#493e36", eyebrowColor: "#3c3029",
  clothes: ["male_elegantsuit01"],
  detail: {
    headWidth: 0.01, headHeight: 0.01, faceFat: 0.04, jaw: 0.03,
    chinProminence: 0.06, cheekBones: 0.04, eyeSize: -0.04, eyeOpening: -0.08,
    eyeBags: 0.06, mouthWidth: 0.03, mouthCorners: 0.04, browHeight: 0.02,
    neckWidth: 0.07, shoulders: 0.06,
  },
};

Object.assign(window, {
  async exportInterviewerV2() {
    const avatar = new HumanAvatar(await loadHumanPackage("/forge-assets"));
    avatar.textureSize = "2k";
    avatar.normalMaps = true;
    await avatar.setConfig(config);
    avatar.group.userData = {
      title: "Interviewer v2", source: "HumanForge / MakeHuman / MPFB",
      license: "CC0-1.0", config,
    };
    avatar.group.traverse((object) => {
      const mesh = object as SkinnedMesh;
      if (!mesh.isMesh) return;
      if (mesh.userData.softPass) mesh.visible = false;
      const material = mesh.material as MeshStandardMaterial;
      material.name = mesh.name;
      if (mesh.name === "body") material.roughness = 0.72;
      if (/^hair-/.test(mesh.name)) {
        material.transparent = false;
        material.alphaTest = 0.42;
        material.roughness = 0.86;
        material.metalness = 0;
        material.alphaToCoverage = true;
      }
      if (/^eyebrows-|^eyelashes-/.test(mesh.name)) {
        material.alphaTest = 0.2;
        material.depthWrite = true;
        material.roughness = 0.88;
      }
      if (/^clothes-/.test(mesh.name)) {
        material.roughness = 0.88;
        material.normalScale.set(0.65, 0.65);
      }
      if (material.map) {
        material.map.userData.mimeType = material.transparent || material.alphaTest > 0 ? "image/png" : "image/jpeg";
      }
      if (material.normalMap) material.normalMap.userData.mimeType = "image/png";
      const targets = mesh.geometry.morphAttributes.position;
      if (!targets || !mesh.morphTargetDictionary) return;
      const selected = Object.entries(mesh.morphTargetDictionary)
        .filter(([, index]) => targets[index].array.some(value => Math.abs(value) > 1e-8));
      mesh.geometry.morphAttributes.position = selected.map(([, index]) => targets[index]);
      delete mesh.morphTargetDictionary;
      delete mesh.morphTargetInfluences;
      if (selected.length) {
        mesh.morphTargetDictionary = Object.fromEntries(selected.map(([name], index) => [name, index]));
        mesh.morphTargetInfluences = selected.map(() => 0);
      }
    });
    const glb = await new GLTFExporter().parseAsync(avatar.group, {
      binary: true, onlyVisible: true, maxTextureSize: 2048,
    }) as ArrayBuffer;
    const bytes = new Uint8Array(glb);
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
    }
    return btoa(chunks.join(""));
  },
});

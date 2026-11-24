import type { Mesh, MeshStandardMaterial, Object3D } from "three";

/** Restore the exported material's cutouts and separate skin, hair and fabric. */
export function prepareInterviewerMaterials(THREE: typeof import("three"), root: Object3D) {
  const pores = new Uint8Array(128 * 128);
  let seed = 41;
  for (let i = 0; i < pores.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pores[i] = 100 + (seed >>> 26);
  }
  const skinDetail = new THREE.DataTexture(pores, 128, 128, THREE.RedFormat);
  skinDetail.wrapS = skinDetail.wrapT = THREE.RepeatWrapping;
  skinDetail.repeat.set(22, 22);
  skinDetail.magFilter = THREE.LinearFilter;
  skinDetail.minFilter = THREE.LinearMipmapLinearFilter;
  skinDetail.generateMipmaps = true;
  skinDetail.needsUpdate = true;

  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const configure = (material: MeshStandardMaterial) => {
      if (!material.isMeshStandardMaterial) return material;
      const name = `${mesh.name} ${material.name}`;
      material.metalness = 0;
      if (/^body\b|skin/i.test(name)) {
        const skin = new THREE.MeshPhysicalMaterial({
          name: material.name,
          color: material.color,
          map: material.map,
          normalMap: material.normalMap,
          roughness: 0.64,
          metalness: 0,
          specularIntensity: 0.3,
          specularColor: 0xffeadb,
          sheen: 0.12,
          sheenColor: 0xe8b5a0,
          sheenRoughness: 0.85,
          bumpMap: skinDetail,
          bumpScale: 0.0001,
        });
        material.dispose();
        return skin;
      }
      if (/hair|eyebrow|eyelash/i.test(name)) {
        // Hair is a cutout. BLEND with a near-zero cutoff exposes the grey
        // pixels around every card and makes the top of the head look broken.
        material.transparent = false;
        material.alphaTest = /hair/i.test(name) ? 0.42 : 0.3;
        material.alphaToCoverage = true;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;
        material.roughness = /hair/i.test(name) ? 0.8 : 0.95;
        mesh.castShadow = /hair/i.test(name);
      } else if (/eyes/i.test(name)) {
        material.roughness = 0.17;
        material.envMapIntensity = 0.65;
        mesh.castShadow = false;
      } else if (/teeth/i.test(name)) {
        material.color.set(0xe7e2d8);
        material.roughness = 0.55;
      } else if (/clothes/i.test(name)) {
        material.roughness = 0.9;
        material.normalScale.set(0.6, 0.6);
      }
      material.needsUpdate = true;
      return material;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(material => configure(material as MeshStandardMaterial))
      : configure(mesh.material as MeshStandardMaterial);
  });
  return () => skinDetail.dispose();
}

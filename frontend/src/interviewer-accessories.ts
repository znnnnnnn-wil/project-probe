import type { Mesh, Object3D } from "three";

/** Lightweight, model-fitted glasses; parented to the head so expressions and nods stay aligned. */
export function addInterviewerGlasses(THREE: typeof import("three"), root: Object3D, head?: Object3D) {
  if (!head) return;
  let eyes: Mesh | undefined;
  root.traverse(object => {
    if ((object as Mesh).isMesh && /^eyes/i.test(object.name)) eyes = object as Mesh;
  });
  if (!eyes) return;
  const bounds = new THREE.Box3().setFromObject(eyes);
  const center = bounds.getCenter(new THREE.Vector3());
  const width = bounds.max.x - bounds.min.x;
  const frame = new THREE.Group();
  frame.name = "interviewer-optical-frames";
  const acetate = new THREE.MeshStandardMaterial({ color: 0x302d29, roughness: 0.4, metalness: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x99836b, roughness: 0.35, metalness: 0.75 });
  const lensWidth = width * 0.57;
  const lensHeight = width * 0.31;
  const eyeOffset = width * 0.36;
  const front = bounds.max.z + width * 0.17;
  const point = (x: number, y: number) => new THREE.Vector3(
    center.x + x, center.y + y, front - Math.pow(x / width, 2) * width * 0.35,
  );
  const tube = (points: import("three").Vector3[], radius: number, closed = false, metallic = false) => {
    const curve = new THREE.CatmullRomCurve3(points, closed);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, closed ? 64 : 20, radius, 6, closed), metallic ? metal : acetate);
    mesh.castShadow = false;
    frame.add(mesh);
  };
  for (const side of [-1, 1]) {
    const x = side * eyeOffset;
    const w = lensWidth / 2;
    const h = lensHeight / 2;
    const r = width * 0.085;
    const outline = new THREE.Shape();
    outline.moveTo(-w + r, -h);
    outline.lineTo(w - r, -h);
    outline.quadraticCurveTo(w, -h, w, -h + r);
    outline.lineTo(w, h - r);
    outline.quadraticCurveTo(w, h, w - r, h);
    outline.lineTo(-w + r, h);
    outline.quadraticCurveTo(-w, h, -w, h - r);
    outline.lineTo(-w, -h + r);
    outline.quadraticCurveTo(-w, -h, -w + r, -h);
    const points = outline.getPoints(8).slice(0, -1).map(p => point(x + p.x, p.y));
    tube(points, width * 0.012, true);
    const outer = side * (eyeOffset + w);
    tube([
      point(outer, h * 0.55),
      new THREE.Vector3(center.x + side * width * 0.78, center.y + h * 0.45, center.z),
      new THREE.Vector3(center.x + side * width * 0.82, center.y, center.z - width * 0.6),
    ], width * 0.01);
  }
  const bridge = eyeOffset - lensWidth / 2;
  tube([point(-bridge, lensHeight * 0.16), point(0, lensHeight * 0.26), point(bridge, lensHeight * 0.16)], width * 0.008, false, true);
  root.add(frame);
  root.updateMatrixWorld(true);
  head.attach(frame);
}

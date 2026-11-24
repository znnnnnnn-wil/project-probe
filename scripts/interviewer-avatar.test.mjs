import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = path.join(project, "frontend/public/models/interviewer-v2.glb");
test("职业人物保留真实表情、头发遮罩和可直接加载的标准glTF", async () => {
  const bytes = await readFile(model);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.ok(bytes.length < 4_000_000);
  const data = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  assert.deepEqual(data.extensionsRequired || [], []);
  const face = data.meshes.find(mesh => mesh.extras?.targetNames?.includes("mouthPucker"));
  assert.equal(face.extras.targetNames.length, 34);
  for (const name of ["eyeBlinkLeft", "jawOpen", "mouthSmile", "mouthPress", "browInnerUpLeft"])
    assert.ok(face.extras.targetNames.includes(name), name);
  const hair = data.materials.find(material => /^hair-/.test(material.name));
  assert.equal(hair.alphaMode, "MASK");
  assert.ok(hair.alphaCutoff >= 0.4);
  assert.ok(data.accessors.some(accessor => accessor.sparse));
});

test("对最终资产再次稀疏化不会改变文件内容", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "interviewer-avatar-"));
  try {
    const output = path.join(folder, "repacked.glb");
    await promisify(execFile)(process.execPath, [path.join(project, "scripts/sparsify-avatar-glb.mjs"), model, output]);
    assert.deepEqual(await readFile(output), await readFile(model));
  } finally {
    await rm(path.join(folder, "repacked.glb"), { force: true });
    await rmdir(folder);
  }
});

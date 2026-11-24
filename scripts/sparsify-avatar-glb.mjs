import fs from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.argv[2] || "frontend/public/models/interviewer-v2.glb");
const output = path.resolve(process.argv[3] || ".runtime/interviewer-v2-sparse.glb");
const input = await fs.readFile(source);
if (input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(4) !== 2) throw new Error("Expected GLB v2");
const jsonLength = input.readUInt32LE(12);
const json = JSON.parse(input.toString("utf8", 20, 20 + jsonLength));
const original = structuredClone(json);
const binHeader = 20 + jsonLength;
if (input.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error("Expected BIN chunk");
const binary = input.subarray(binHeader + 8, binHeader + 8 + input.readUInt32LE(binHeader));
if (json.buffers.length !== 1) throw new Error("Expected a single embedded buffer");
const align = value => (value + 3) & ~3;

function morphBytes(document, bin, index) {
  const accessor = document.accessors[index];
  if (accessor.type !== "VEC3" || accessor.componentType !== 5126) throw new Error("Expected float VEC3 morph");
  const bytes = Buffer.alloc(accessor.count * 12);
  if (accessor.bufferView !== undefined) {
    const view = document.bufferViews[accessor.bufferView];
    const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    for (let i = 0; i < accessor.count; i++) bin.copy(bytes, i * 12, base + i * (view.byteStride || 12), base + i * (view.byteStride || 12) + 12);
  }
  if (accessor.sparse) {
    const sparse = accessor.sparse;
    const indicesView = document.bufferViews[sparse.indices.bufferView];
    const valuesView = document.bufferViews[sparse.values.bufferView];
    const componentBytes = { 5121: 1, 5123: 2, 5125: 4 }[sparse.indices.componentType];
    if (!componentBytes) throw new Error("Invalid sparse index type");
    const indicesBase = (indicesView.byteOffset || 0) + (sparse.indices.byteOffset || 0);
    const valuesBase = (valuesView.byteOffset || 0) + (sparse.values.byteOffset || 0);
    for (let i = 0; i < sparse.count; i++) {
      const vertex = componentBytes === 1 ? bin.readUInt8(indicesBase + i) : componentBytes === 2 ? bin.readUInt16LE(indicesBase + i * 2) : bin.readUInt32LE(indicesBase + i * 4);
      bin.copy(bytes, vertex * 12, valuesBase + i * 12, valuesBase + i * 12 + 12);
    }
  }
  return bytes;
}

const morphAccessors = new Set();
for (const mesh of json.meshes) for (const primitive of mesh.primitives) for (const target of primitive.targets || []) {
  if (target.POSITION !== undefined) morphAccessors.add(target.POSITION);
}
const appended = new Map();
let converted = 0;
for (const index of morphAccessors) {
  const accessor = json.accessors[index];
  const dense = morphBytes(original, binary, index);
  const nonzero = [];
  for (let vertex = 0; vertex < accessor.count; vertex++) {
    const offset = vertex * 12;
    // Test the exact bits, retaining negative zero as well as arbitrarily small deltas.
    if (dense.readUInt32LE(offset) || dense.readUInt32LE(offset + 4) || dense.readUInt32LE(offset + 8)) nonzero.push(vertex);
  }
  const indexBytes = accessor.count <= 65535 ? 2 : 4;
  if (!nonzero.length || nonzero.length * (12 + indexBytes) + 160 >= dense.length) continue;
  const indices = Buffer.alloc(nonzero.length * indexBytes);
  const values = Buffer.alloc(nonzero.length * 12);
  nonzero.forEach((vertex, offset) => {
    if (indexBytes === 2) indices.writeUInt16LE(vertex, offset * 2); else indices.writeUInt32LE(vertex, offset * 4);
    dense.copy(values, offset * 12, vertex * 12, vertex * 12 + 12);
  });
  const indicesView = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteLength: indices.length });
  appended.set(indicesView, indices);
  const valuesView = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteLength: values.length });
  appended.set(valuesView, values);
  delete accessor.bufferView;
  delete accessor.byteOffset;
  accessor.sparse = {
    count: nonzero.length,
    indices: { bufferView: indicesView, componentType: indexBytes === 2 ? 5123 : 5125 },
    values: { bufferView: valuesView },
  };
  converted++;
}

function visitReferences(object, update) {
  if (Array.isArray(object)) { object.forEach(value => visitReferences(value, update)); return; }
  if (!object || typeof object !== "object") return;
  for (const key of Object.keys(object)) {
    if (key === "bufferViews") continue;
    if (key === "bufferView") object[key] = update(object[key]);
    else visitReferences(object[key], update);
  }
}
const referenced = new Set();
visitReferences(json, index => { referenced.add(index); return index; });
const views = [];
const parts = [];
const mapping = new Map();
let length = 0;
for (const oldIndex of [...referenced].sort((a, b) => a - b)) {
  const view = json.bufferViews[oldIndex];
  if (view.buffer !== 0) throw new Error("Unexpected external view");
  const bytes = appended.get(oldIndex) || binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  const padding = align(length) - length;
  if (padding) { parts.push(Buffer.alloc(padding)); length += padding; }
  mapping.set(oldIndex, views.length);
  views.push({ ...view, byteOffset: length });
  parts.push(bytes);
  length += bytes.length;
}
if (align(length) !== length) parts.push(Buffer.alloc(align(length) - length));
const nextBinary = Buffer.concat(parts);
visitReferences(json, index => mapping.get(index));
json.bufferViews = views;
json.buffers[0].byteLength = nextBinary.length;

// Exact byte-level comparison of every decoded facial morph, plus retained views.
for (const index of morphAccessors) {
  if (!morphBytes(original, binary, index).equals(morphBytes(json, nextBinary, index))) throw new Error(`Morph ${index} changed`);
}
for (const [oldIndex, newIndex] of mapping) {
  if (appended.has(oldIndex)) continue;
  const before = original.bufferViews[oldIndex];
  const after = json.bufferViews[newIndex];
  if (!binary.subarray(before.byteOffset || 0, (before.byteOffset || 0) + before.byteLength)
    .equals(nextBinary.subarray(after.byteOffset, after.byteOffset + after.byteLength))) throw new Error(`View ${oldIndex} changed`);
}
const text = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.alloc(align(text.length), 0x20);
text.copy(jsonChunk);
const glb = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + nextBinary.length);
glb.writeUInt32LE(0x46546c67, 0);
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(jsonChunk.length, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
jsonChunk.copy(glb, 20);
const nextBinHeader = 20 + jsonChunk.length;
glb.writeUInt32LE(nextBinary.length, nextBinHeader);
glb.writeUInt32LE(0x004e4942, nextBinHeader + 4);
nextBinary.copy(glb, nextBinHeader + 8);
await fs.writeFile(output, glb);
console.log(JSON.stringify({ source, output, before: input.length, after: glb.length, converted, verifiedMorphs: morphAccessors.size, extensionsRequired: json.extensionsRequired || [] }, null, 2));

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

export function vadAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const vad = dirname(require.resolve("@ricky0123/vad-web"));
  const wasm = dirname(require.resolve("onnxruntime-web/wasm"));
  const prefix = "vad/0.0.31-ort1.22/";
  const assets = new Map([
    [prefix + "silero_vad_v5.onnx", join(vad, "silero_vad_v5.onnx")],
    [
      prefix + "ort-wasm-simd-threaded.wasm",
      join(wasm, "ort-wasm-simd-threaded.wasm"),
    ],
    [
      prefix + "ort-wasm-simd-threaded.mjs",
      join(wasm, "ort-wasm-simd-threaded.mjs"),
    ],
  ]);
  return {
    name: "self-hosted-vad-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? "").split("?")[0].slice(1);
        const file = assets.get(name);
        if (!file) return next();
        res.setHeader(
          "Content-Type",
          name.endsWith(".mjs")
            ? "text/javascript"
            : name.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream",
        );
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [fileName, file] of assets)
        this.emitFile({ type: "asset", fileName, source: readFileSync(file) });
    },
  };
}

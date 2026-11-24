import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

export function visionAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const wasm = join(dirname(require.resolve("@mediapipe/tasks-vision")), "wasm");
  const prefix = "mediapipe-wasm/";
  const names = [
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_module_internal.js",
    "vision_wasm_module_internal.wasm",
  ];
  const assets = new Map(names.map((name) => [prefix + name, join(wasm, name)]));
  return {
    name: "self-hosted-vision-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? "").split("?")[0].slice(1);
        const file = assets.get(name);
        if (!file) return next();
        res.setHeader(
          "Content-Type",
          name.endsWith(".js")
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
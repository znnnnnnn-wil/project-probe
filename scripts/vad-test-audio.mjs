import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function speechBase64() {
  const file = path.join(root, ".runtime/vad-acceptance/synthetic-speech.wav");
  if (!existsSync(file)) {
    if (process.platform === "win32") execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/synthetic-vad-audio.ps1"), "-OutputPath", file], { windowsHide: true });
    else {
      mkdirSync(path.dirname(file), { recursive: true });
      execFileSync("espeak-ng", ["-w", file, "-s", "150", "This is synthetic test audio. I implemented the reservation interface and concurrency tests."]);
    }
  }
  return readFileSync(file).toString("base64");
}

export async function injectSpeechPCM(page, noise = false) {
  await page.evaluate(async ({ base64, noise }) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const decoder = new OfflineAudioContext(1, 1, 16000);
    const audio = await decoder.decodeAudioData(bytes.buffer);
    const speech = audio.getChannelData(0);
    const Native = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Native {
      constructor(...args) {
        super(...args);
        if (args[1] !== "voice-recorder") return;
        let cursor = 0, random = 12345;
        this.port.addEventListener("message", event => {
          const chunk = event.data;
          for (let i = 0; i < chunk.length; i++) {
            random = (random * 16807) % 2147483647;
            chunk[i] = noise ? (random / 2147483647 - 0.5) * 0.1 : speech[cursor] ?? 0;
            cursor++;
          }
        });
      }
    };
  }, { base64: speechBase64(), noise });
}

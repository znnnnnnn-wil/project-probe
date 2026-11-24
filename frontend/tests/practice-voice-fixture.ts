import { expect, type Page } from "@playwright/test";

export type TestVoiceWindow = Window & typeof globalThis & {
  testMic?: MediaStreamTrack;
  testMicRequested: boolean;
  testGrantMic: () => void;
  testVadArmed: boolean;
  testPlayback?: SpeechSynthesisUtterance;
  testInterrupted: SpeechSynthesisUtterance[];
  testBroadcasts: { text: string; micReady: boolean }[];
  testSpeechStart: () => void;
  testSpeechEnd: () => void;
};

export async function mockHandsFree(page: Page, delayMic = false) {
  await page.route(/\/src\/voice-activity\.ts(?:\?|$)/, route => route.fulfill({
    contentType: "text/javascript",
    body: [
      "export class VoiceActivity {",
      "  static async create(_rate, begin, end) {",
      "    let armed = false;",
      "    let speaking = false;",
      "    window.testSpeechStart = () => { if (armed && !speaking) { speaking = true; begin(); } };",
      "    window.testSpeechEnd = () => { if (armed && speaking) { speaking = false; end(new Float32Array(16000).fill(0.25)); } };",
      "    const mute = () => { window.testVadArmed = armed = false; speaking = false; };",
      "    return { feed() {}, pause: mute, async resume() { window.testVadArmed = armed = true }, async destroy() { mute(); } };",
      "  }",
      "}",
    ].join("\n"),
  }));
  await page.addInitScript(blockMic => {
    const state = window as TestVoiceWindow;
    state.testMicRequested = false;
    state.testVadArmed = false;
    state.testInterrupted = [];
    state.testBroadcasts = [];
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        if (blockMic) await new Promise<void>(resolve => {
          state.testGrantMic = resolve;
          state.testMicRequested = true;
        });
        else state.testMicRequested = true;
        const stream = new AudioContext().createMediaStreamDestination().stream;
        state.testMic = stream.getAudioTracks()[0];
        return stream;
      },
    });
    Object.defineProperties(speechSynthesis, {
      speak: { value: (utterance: SpeechSynthesisUtterance) => {
        state.testPlayback = utterance;
        state.testBroadcasts.push({ text: utterance.text, micReady: state.testVadArmed && state.testMic?.enabled === true });
        queueMicrotask(() => utterance.onstart?.(new Event("start") as SpeechSynthesisEvent));
      } },
      cancel: { value: () => {
        if (state.testPlayback) state.testInterrupted.push(state.testPlayback);
        state.testPlayback = undefined;
      } },
    });
  }, delayMic);
  return {
    micRequested: () => page.evaluate(() => (window as TestVoiceWindow).testMicRequested),
    grantMic: () => page.evaluate(() => (window as TestVoiceWindow).testGrantMic()),
    micState: () => page.evaluate(() => {
      const mic = (window as TestVoiceWindow).testMic;
      return mic ? [mic.readyState, mic.enabled] : null;
    }),
    playback: () => page.evaluate(() => {
      const state = window as TestVoiceWindow;
      return {
        playing: state.testPlayback?.text ?? null,
        interrupted: state.testInterrupted.map(utterance => utterance.text),
      };
    }),
    broadcasts: () => page.evaluate(() => (window as TestVoiceWindow).testBroadcasts),
    beginSpeech: () => page.evaluate(() => (window as TestVoiceWindow).testSpeechStart()),
    endSpeech: () => page.evaluate(() => (window as TestVoiceWindow).testSpeechEnd()),
  };
}

export async function mockPracticeVoice(page: Page, transcript: () => string) {
  const voice = await mockHandsFree(page);
  await page.route("**/api/config", route => route.fulfill({
    json: { modelMode: "demo", speechEnabled: true, ttsEnabled: false },
  }));
  await page.route(/\/api\/(?:examples\/)?projects\/[^/]+\/practice\/transcribe$/, route =>
    route.fulfill({ json: { text: transcript() } }));
  return {
    async speak() {
      await expect.poll(voice.micState).toEqual(["live", true]);
      await voice.beginSpeech();
      await voice.endSpeech();
    },
  };
}

import { expect, test } from "@playwright/test";

type ExampleVoiceTestWindow = Window & {
  exampleMic?: MediaStreamTrack;
  examplePlayback?: SpeechSynthesisUtterance;
  endExampleSpeech?: () => void;
  hearExampleAnswer?: (text: string) => void;
};

test("已有的旧版示例仍可使用免提语音续练", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 401 }));
  await page.route(/\/src\/voice-activity\.ts(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: [
        "export class VoiceActivity {",
        "  static async create(_rate, _begin, end) {",
        "    window.endExampleSpeech = end;",
        "    return { feed() {}, async destroy() { delete window.endExampleSpeech; } };",
        "  }",
        "}",
      ].join("\n"),
    }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem("project-probe:experience:v1", JSON.stringify({
      version: 1, sample: "booking", started: true, answers: [], draft: "",
      notes: Array(5).fill(""), checked: Array(5).fill(false),
    }));
    const state = window as ExampleVoiceTestWindow;
    const audio = new AudioContext();
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const stream = audio.createMediaStreamDestination().stream;
        state.exampleMic = stream.getAudioTracks()[0];
        return stream;
      },
    });
    Object.defineProperties(speechSynthesis, {
      speak: {
        value: (utterance: SpeechSynthesisUtterance) => {
          state.examplePlayback = utterance;
          queueMicrotask(() =>
            utterance.onstart?.(new Event("start") as SpeechSynthesisEvent),
          );
        },
      },
      cancel: { value: () => { delete state.examplePlayback; } },
    });
    Object.defineProperty(window, "SpeechRecognition", {
      value: class {
        onstart?: () => void;
        onend?: () => void;
        onresult?: (event: { results: Array<[{ transcript: string }]> }) => void;

        start() {
          state.hearExampleAnswer = (text) => {
            this.onresult?.({ results: [[{ transcript: text }]] });
          };
          queueMicrotask(() => this.onstart?.());
        }
        stop() {
          queueMicrotask(() => this.onend?.());
        }
        abort() {
          delete state.hearExampleAnswer;
        }
      },
    });
  });

  const micState = () => page.evaluate(() =>
    (window as ExampleVoiceTestWindow).exampleMic?.readyState ?? null,
  );
  const endPlayback = () => page.evaluate(() => {
    (window as ExampleVoiceTestWindow).examplePlayback?.onend?.(
      new Event("end") as SpeechSynthesisEvent,
    );
  });
  const finishSpeech = () => page.evaluate(() => {
    (window as ExampleVoiceTestWindow).endExampleSpeech?.();
  });

  await page.goto("/#/experience?mode=legacy");
  await expect(page.getByRole("button", { name: "开始语音输入" })).toHaveCount(0);
  await page.getByRole("button", { name: "同意并进入语音面试" }).click();

  const room = page.getByRole("dialog", { name: "示例面试室" });
  const ready = room.getByText("麦克风已开启，可以直接说话");
  const turnTaking = room.getByText("轮到你时，麦克风会自动恢复");
  const pause = room.getByRole("button", { name: "暂停语音面试" });
  await expect(turnTaking).toBeVisible();
  expect(await micState()).toBeNull();
  await endPlayback();
  await expect(ready).toBeVisible();

  await pause.click();
  await expect(room.getByText("麦克风已暂停")).toBeVisible();
  await expect.poll(micState).toBe("ended");
  await room.getByRole("button", { name: "继续语音面试" }).click();
  await expect(ready).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    typeof (window as ExampleVoiceTestWindow).endExampleSpeech,
  )).toBe("function");

  await page.evaluate(() =>
    (window as ExampleVoiceTestWindow).hearExampleAnswer?.("我负责预约创建接口。"),
  );
  await expect(room.getByText("正在听你说话")).toBeVisible();
  await expect(room.getByRole("button", { name: /结束并发送|结束并填入/ })).toHaveCount(0);
  await finishSpeech();
  await expect(room.getByText("第 2 / 5 题")).toBeVisible();
  await expect(turnTaking).toBeVisible();
  await expect.poll(micState).toBe("ended");
  await endPlayback();
  await expect(ready).toBeVisible();

  await room.getByRole("button", { name: "改用文字回答" }).click();
  await expect(room.getByRole("textbox", { name: "本轮回答" })).toBeVisible();
  await expect(room.getByRole("button", { name: "开始语音输入" })).toHaveCount(0);
  await expect.poll(micState).toBe("ended");
});

import { test, expect } from "@playwright/test";
import { FrameProcessor, Message } from "@ricky0123/vad-web";

async function events(probabilities: number[]) {
  const result: Message[] = [];
  const processor = new FrameProcessor(
    async (frame) => ({ isSpeech: frame[0], notSpeech: 1 - frame[0] }),
    () => {},
    {
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 2000,
      preSpeechPadMs: 300,
      minSpeechMs: 400,
      submitUserSpeechOnPause: false,
    },
    32,
  );
  processor.resume();
  for (const p of probabilities)
    await processor.process(new Float32Array(512).fill(p), (event) =>
      result.push(event.msg),
    );
  return result;
}

test("低语音概率不会启动说话结束事件", async () => {
  expect(await events(Array(320).fill(0.1))).not.toContain(
    Message.SpeechRealStart,
  );
});
test("语音概率确认讲话后，2秒静音产生结束事件", async () => {
  const result = await events([...Array(16).fill(0.9), ...Array(64).fill(0.1)]);
  expect(result).toContain(Message.SpeechRealStart);
  expect(result.filter((event) => event === Message.SpeechEnd)).toHaveLength(1);
});
test("短噪声误触发不输出语音，短停顿继续讲话不结束", async () => {
  expect(await events([0.9, ...Array(64).fill(0.1)])).not.toContain(
    Message.SpeechEnd,
  );
  expect(
    await events([
      ...Array(16).fill(0.9),
      ...Array(30).fill(0.1),
      ...Array(16).fill(0.9),
    ]),
  ).not.toContain(Message.SpeechEnd);
});

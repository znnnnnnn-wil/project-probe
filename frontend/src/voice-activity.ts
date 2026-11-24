import { FrameProcessor, Message } from "@ricky0123/vad-web";
import type { FrameProcessorEvent, FrameProcessorOptions } from "@ricky0123/vad-web/dist/frame-processor";
import { Silero } from "@ricky0123/vad-web/dist/models";
import { Resampler } from "@ricky0123/vad-web/dist/resampler";
import * as ort from "onnxruntime-web/wasm";

export const VAD_ASSETS = "/vad/0.0.31-ort1.22/";
export const VAD_OPTIONS = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionMs: 2000,
  preSpeechPadMs: 300,
  minSpeechMs: 400,
  submitUserSpeechOnPause: false,
};

export class VoiceActivity {
  private pending: Float32Array[] = [];
  private running: Promise<void> | null = null;
  private closed = false;
  private paused = false;
  private pauseVersion = 0;
  private reset: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private processor: FrameProcessor;
  private resampler: Resampler;

  static async create(
    rate: number,
    speech: () => void,
    end: (audio: Float32Array) => void,
    failed: () => void,
    options: Partial<FrameProcessorOptions> = {},
  ) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = VAD_ASSETS;
    ort.env.logLevel = "error";
    const model = await Silero.new(ort, async () => {
      const response = await fetch(VAD_ASSETS + "silero_vad_v5.onnx");
      if (!response.ok) throw new Error("VAD model unavailable");
      return response.arrayBuffer();
    });
    return new VoiceActivity(model, rate, speech, end, failed, options);
  }

  private constructor(
    private model: Awaited<ReturnType<typeof Silero.new>>,
    private rate: number,
    private speech: () => void,
    private end: (audio: Float32Array) => void,
    private failed: () => void,
    options: Partial<FrameProcessorOptions>,
  ) {
    this.processor = new FrameProcessor(
      model.process,
      model.reset_state,
      { ...VAD_OPTIONS, ...options },
      32,
    );
    this.processor.resume();
    this.resampler = this.createResampler();
  }

  private createResampler() {
    return new Resampler({
      nativeSampleRate: this.rate,
      targetSampleRate: 16000,
      targetFrameSize: 512,
    });
  }

  feed(chunk: Float32Array) {
    if (this.closed || this.paused) return;
    this.pending.push(...this.resampler.process(chunk));
    if (this.pending.length > 64) {
      this.fail();
      return;
    }
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
  }

  private async drain() {
    try {
      while (!this.closed && !this.paused && this.pending.length)
        await this.processor.process(this.pending.shift()!, this.emit);
    } catch {
      this.fail();
    }
  }

  private emit = (event: FrameProcessorEvent) => {
    if (this.closed || this.paused) return;
    if (event.msg === Message.SpeechRealStart) this.speech();
    if (event.msg === Message.SpeechEnd) this.end(event.audio);
  };

  pause() {
    this.pauseVersion++;
    if (this.closed || this.paused) return;
    this.paused = true;
    this.pending = [];
    this.reset = Promise.resolve(this.running).then(() => {
      if (this.closed) return;
      this.processor.pause(() => {});
      this.resampler = this.createResampler();
    });
  }

  async resume() {
    const version = this.pauseVersion;
    await this.reset;
    if (this.closed || version !== this.pauseVersion) return;
    this.processor.resume();
    this.paused = false;
  }

  async endSegment() {
    const version = this.pauseVersion;
    this.pending = [];
    await this.running;
    if (this.closed || this.paused || version !== this.pauseVersion) return;
    this.processor.endSegment(this.emit);
  }

  private fail() {
    if (this.closed) return;
    this.closed = true;
    this.pending = [];
    this.failed();
  }

  destroy(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.pending = [];
    this.disposal = Promise.resolve(this.running).then(async () => {
      this.processor.pause(() => {});
      await this.model.release();
    });
    return this.disposal;
  }
}

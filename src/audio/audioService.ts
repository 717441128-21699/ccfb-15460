/**
 * Web Audio API 封装：文件解码、麦克风录音、播放。
 * 特征提取用自研 FFT（见 dsp/features.ts），Web Audio 只负责 I/O。
 */
import { decodeWav } from '../dsp/wav.ts';

export interface LoadedAudio {
  samples: Float64Array;
  sampleRate: number;
  durationSec: number;
  fileName: string;
}

/** 解码音频文件：WAV 走自有解析器，其余格式（mp3/m4a/ogg…）交给 Web Audio */
export async function loadAudioFile(file: File | Blob, fileName = 'audio'): Promise<LoadedAudio> {
  const isWav = fileName.toLowerCase().endsWith('.wav') || file.type === 'audio/wav' || file.type === 'audio/x-wav';

  if (isWav) {
    const buf = await file.arrayBuffer();
    try {
      const { samples, sampleRate } = decodeWav(buf);
      return { samples, sampleRate, durationSec: samples.length / sampleRate, fileName };
    } catch {
      // 非 PCM 的 WAV（如 G.711）回退到 Web Audio 解码
    }
  }

  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    const ch0 = audioBuf.getChannelData(0);
    const samples = new Float64Array(ch0.length);
    samples.set(ch0);
    if (audioBuf.numberOfChannels > 1) {
      const ch1 = audioBuf.getChannelData(1);
      for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] + ch1[i]) / 2;
    }
    return {
      samples,
      sampleRate: audioBuf.sampleRate,
      durationSec: audioBuf.duration,
      fileName,
    };
  } finally {
    void ctx.close();
  }
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private recordedRate = 0;

  async start(): Promise<void> {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor 兼容性最好；缓冲区 4096
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.recordedRate = this.ctx.sampleRate;
    this.processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
    };
    this.source.connect(this.processor);
    // 部分浏览器要求 processor 连到 destination 才会回调
    this.processor.connect(this.ctx.destination);
  }

  async stop(): Promise<LoadedAudio> {
    if (!this.ctx || !this.processor) throw new Error('录音尚未开始');
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Float64Array(total);
    let off = 0;
    for (const c of this.chunks) {
      merged.set(c, off);
      off += c.length;
    }
    const sr = this.recordedRate;
    this.processor.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx.close();
    this.ctx = null;
    this.processor = null;
    this.source = null;
    this.stream = null;
    return { samples: merged, sampleRate: sr, durationSec: merged.length / sr, fileName: '麦克风录音' };
  }
}

let playCtx: AudioContext | null = null;

export function playAudio(audio: LoadedAudio): void {
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!playCtx) playCtx = new AC();
  const buf = playCtx.createBuffer(1, audio.samples.length, audio.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < audio.samples.length; i++) ch[i] = audio.samples[i];
  const node = playCtx.createBufferSource();
  node.buffer = buf;
  node.connect(playCtx.destination);
  node.start();
}

/**
 * 频域零相位滤波器与一阶时域 IIR（用于合成链路）。
 * 特征提取本身只做分析、不做滤波；这些滤波器服务于测试录音合成。
 */
import { fft } from './fft.ts';

/** 对整段信号做零相位频域滤波（幅度响应 mag 的长度为 n/2+1，线性频率） */
export function applyMagnitudeResponse(sig: Float64Array, mag: Float64Array): Float64Array {
  const n = sig.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(sig);
  fft(re, im);

  re[0] *= mag[0];
  im[0] *= mag[0];
  const half = n / 2;
  for (let k = 1; k < half; k++) {
    re[k] *= mag[k];
    im[k] *= mag[k];
    re[n - k] *= mag[k];
    im[n - k] *= mag[k];
  }
  re[half] *= mag[half];
  im[half] *= mag[half];

  // 逆 FFT：共轭 + 正变换 + 缩放
  for (let k = 1; k < half; k++) im[k] = -im[k];
  for (let k = half + 1; k < n; k++) im[k] = -im[k];
  fft(re, im);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i] / n;
  return out;
}

/** 一阶高通：直流去除 / 低频滚降模拟 */
export class HighPass1 {
  private x1 = 0;
  private y1 = 0;
  private readonly a: number;

  constructor(fc: number, sampleRate: number) {
    const rc = 1 / (2 * Math.PI * fc);
    const dt = 1 / sampleRate;
    this.a = rc / (rc + dt);
  }

  process(x: number): number {
    const y = this.a * (this.y1 + x - this.x1);
    this.x1 = x;
    this.y1 = y;
    return y;
  }

  filter(buf: Float64Array): Float64Array {
    const out = new Float64Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = this.process(buf[i]);
    return out;
  }
}

/** 一阶低通：编码器高频截止模拟 */
export class LowPass1 {
  private y1 = 0;
  private readonly a: number;

  constructor(fc: number, sampleRate: number) {
    const dt = 1 / sampleRate;
    const rc = 1 / (2 * Math.PI * fc);
    this.a = dt / (rc + dt);
  }

  process(x: number): number {
    this.y1 = this.y1 + this.a * (x - this.y1);
    return this.y1;
  }

  filter(buf: Float64Array): Float64Array {
    const out = new Float64Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = this.process(buf[i]);
    return out;
  }
}

/** 一阶低通滤波器幅度响应（用于频域分析建模） */
export function lowPassMagnitude(fc: number, freqs: Float64Array): Float64Array {
  const out = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    const r = freqs[i] / fc;
    out[i] = 1 / Math.sqrt(1 + r * r);
  }
  return out;
}

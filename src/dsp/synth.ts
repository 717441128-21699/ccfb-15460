/**
 * 测试录音合成：按几种设备的频响/噪声/AGC/编码器特征合成仿真录音。
 *
 * 链路：类语音源（共振峰合成，内容随机）→ 麦克风频响（FIR）
 *      → 有色本底噪声 → AGC → 编码器低通 → 16bit 量化
 *
 * 同型号不同个体：在型号模板上对各参数做小幅随机抖动；
 * 不同录音内容：独立的音素序列、基频曲线与停顿，但设备参数保持不变。
 */
import { fft } from './fft.ts';
import { applyMagnitudeResponse, HighPass1, LowPass1 } from './filter.ts';
import { hann } from './windows.ts';
import { Rng } from './rng.ts';

export interface DeviceParams {
  modelName: string;
  sampleRate: number;
  /** 控制点频率（Hz）与对应麦克风增益（dB） */
  micCtrlFreq: number[];
  micCtrlDb: number[];
  micLowCutHz: number;
  /** 本底噪声电平（dBFS，白噪声基准） */
  noiseLevelDb: number;
  /** 噪声低频搁架提升量（dB）与转折频率 */
  noiseShelfDb: number;
  noiseShelfHz: number;
  /** AGC 目标输出电平（dBFS）、启动/恢复时间（秒）、最大增益（dB） */
  agcTargetDb: number;
  agcAttackSec: number;
  agcReleaseSec: number;
  agcMaxGainDb: number;
  /** 编码器高频截止（Hz）与阶数（1~3 级一阶节级联） */
  cutoffHz: number;
  cutoffStages: number;
}

/** 型号模板：控制点固定在 100Hz~12.8kHz 对数等距的 8 个频率上 */
const CTRL_FREQS = [100, 200, 400, 800, 1600, 3200, 6400, 12800];

export const DEVICE_TEMPLATES: DeviceParams[] = [
  {
    modelName: 'Aurora X1',
    sampleRate: 48000,
    micCtrlFreq: CTRL_FREQS,
    micCtrlDb: [-4, -1, 0, 1, 2, 3, 2, -2],
    micLowCutHz: 90,
    noiseLevelDb: -62,
    noiseShelfDb: 7,
    noiseShelfHz: 250,
    agcTargetDb: -18,
    agcAttackSec: 0.04,
    agcReleaseSec: 0.35,
    agcMaxGainDb: 24,
    cutoffHz: 15800,
    cutoffStages: 1,
  },
  {
    modelName: 'Boreal 5',
    sampleRate: 44100,
    micCtrlFreq: CTRL_FREQS,
    micCtrlDb: [-6, -3, -1, 0, 1, 0, -2, -6],
    micLowCutHz: 120,
    noiseLevelDb: -58,
    noiseShelfDb: 10,
    noiseShelfHz: 320,
    agcTargetDb: -15,
    agcAttackSec: 0.08,
    agcReleaseSec: 0.6,
    agcMaxGainDb: 20,
    cutoffHz: 11000,
    cutoffStages: 2,
  },
  {
    modelName: 'Cypress Mini',
    sampleRate: 16000,
    micCtrlFreq: CTRL_FREQS,
    micCtrlDb: [-3, 0, 1, 2, 1, -1, -8, -18],
    micLowCutHz: 100,
    noiseLevelDb: -52,
    noiseShelfDb: 12,
    noiseShelfHz: 400,
    agcTargetDb: -14,
    agcAttackSec: 0.12,
    agcReleaseSec: 0.9,
    agcMaxGainDb: 18,
    cutoffHz: 7500,
    cutoffStages: 2,
  },
  {
    modelName: 'Dune Talk',
    sampleRate: 48000,
    micCtrlFreq: CTRL_FREQS,
    micCtrlDb: [-8, -4, -1, 0, 0, -1, -3, -10],
    micLowCutHz: 160,
    noiseLevelDb: -55,
    noiseShelfDb: 6,
    noiseShelfHz: 200,
    agcTargetDb: -16,
    agcAttackSec: 0.06,
    agcReleaseSec: 0.5,
    agcMaxGainDb: 22,
    cutoffHz: 9000,
    cutoffStages: 3,
  },
  {
    modelName: 'Elba Note',
    sampleRate: 24000,
    micCtrlFreq: CTRL_FREQS,
    micCtrlDb: [-5, -2, 0, 1, 2, 1, -2, -9],
    micLowCutHz: 110,
    noiseLevelDb: -60,
    noiseShelfDb: 9,
    noiseShelfHz: 300,
    agcTargetDb: -17,
    agcAttackSec: 0.1,
    agcReleaseSec: 0.75,
    agcMaxGainDb: 21,
    cutoffHz: 10500,
    cutoffStages: 2,
  },
  {
    modelName: 'Fjord Warm',
    sampleRate: 44100,
    micCtrlFreq: CTRL_FREQS,
    micCtrlDb: [-2, 1, 2, 2, 1, 0, -3, -8],
    micLowCutHz: 80,
    noiseLevelDb: -64,
    noiseShelfDb: 14,
    noiseShelfHz: 180,
    agcTargetDb: -20,
    agcAttackSec: 0.15,
    agcReleaseSec: 1.1,
    agcMaxGainDb: 26,
    cutoffHz: 14000,
    cutoffStages: 1,
  },
  {
    modelName: 'Granite Go',
    sampleRate: 48000,
    micCtrlFreq: CTRL_FREQS,
    micCtrlDb: [-7, -3, 0, 1, 1, 2, 0, -4],
    micLowCutHz: 140,
    noiseLevelDb: -50,
    noiseShelfDb: 8,
    noiseShelfHz: 350,
    agcTargetDb: -13,
    agcAttackSec: 0.03,
    agcReleaseSec: 0.25,
    agcMaxGainDb: 16,
    cutoffHz: 12500,
    cutoffStages: 2,
  },
  {
    modelName: 'Halo Lite',
    sampleRate: 32000,
    micCtrlFreq: CTRL_FREQS,
    micCtrlDb: [-4, -1, 1, 1, 0, -1, -4, -11],
    micLowCutHz: 130,
    noiseLevelDb: -57,
    noiseShelfDb: 11,
    noiseShelfHz: 280,
    agcTargetDb: -16,
    agcAttackSec: 0.09,
    agcReleaseSec: 0.55,
    agcMaxGainDb: 20,
    cutoffHz: 11500,
    cutoffStages: 2,
  },
];

/** 元音共振峰 F1/F2/F3（Hz） */
const VOWELS: Array<[number, number, number]> = [
  [730, 1090, 2440], // a
  [270, 2290, 3010], // i
  [300, 870, 2240], // u
  [530, 1840, 2480], // e
  [570, 840, 2410], // o
  [660, 1700, 2700], // æ
];

/** 标准双二阶节（RBJ），串联使用，各自保持状态 */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }

  static lowpass(fc: number, q: number, sr: number): Biquad {
    const w = (2 * Math.PI * fc) / sr;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad((1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0, (-2 * cw) / a0, (1 - alpha) / a0);
  }

  static bandpass(fc: number, q: number, sr: number): Biquad {
    const w = (2 * Math.PI * fc) / sr;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(alpha / a0, 0, -alpha / a0, (-2 * cw) / a0, (1 - alpha) / a0);
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** 类语音源：浊音脉冲串/清音噪声经三级共振峰滤波，含随机停顿 */
export function generateSpeech(durationSec: number, sampleRate: number, rng: Rng): Float64Array {
  const total = Math.floor(durationSec * sampleRate);
  const out = new Float64Array(total);
  let pos = 0;

  while (pos < total) {
    // 停顿（约占 12% 时长）
    if (rng.next() < 0.12) {
      const pause = Math.floor(rng.uniform(0.15, 0.45) * sampleRate);
      pos += Math.min(pause, total - pos);
      continue;
    }

    const segSec = rng.uniform(0.09, 0.22);
    const segLen = Math.min(Math.floor(segSec * sampleRate), total - pos);
    if (segLen <= 0) break;

    const voiced = rng.next() < 0.82;
    const f0 = rng.uniform(95, 210);
    const formants = rng.pick(VOWELS);
    const filters = voiced
      ? formants.map((f, i) => Biquad.bandpass(f, [6, 8, 10][i], sampleRate))
      : [
          Biquad.bandpass(formants[1], 1.2, sampleRate),
          Biquad.bandpass(formants[2], 1.5, sampleRate),
        ];

    const period = voiced ? sampleRate / f0 : 0;
    let nextPulse = 0;
    const amp = rng.uniform(0.5, 0.9);
    const env = new Float64Array(segLen);
    const at = Math.floor(0.015 * sampleRate);
    const rt = Math.floor(0.03 * sampleRate);
    for (let i = 0; i < segLen; i++) {
      let e = 1;
      if (i < at) e = i / Math.max(at, 1);
      else if (i > segLen - rt) e = Math.max(0, (segLen - i) / Math.max(rt, 1));
      env[i] = e;
    }

    for (let i = 0; i < segLen; i++) {
      let s: number;
      if (voiced) {
        s = 0;
        if (i >= nextPulse) {
          s = 1.6; // 声门脉冲激励
          nextPulse += period * rng.uniform(0.97, 1.03);
        }
      } else {
        s = rng.gaussian() * 0.8;
      }
      for (const bf of filters) s = bf.process(s);
      out[pos + i] += s * amp * env[i] * (voiced ? 0.9 : 0.5);
    }
    pos += segLen;
  }
  return out;
}

/** 对数频率插值：把控制点 dB 曲线插值到线性 FFT 频点 */
function interpDbToLinear(ctrlFreq: number[], ctrlDb: number[], nBins: number, maxHz: number): Float64Array {
  const logF = ctrlFreq.map((f) => Math.log(f));
  const mag = new Float64Array(nBins);
  for (let k = 0; k < nBins; k++) {
    const hz = (k / (nBins - 1)) * maxHz;
    const x = Math.log(Math.max(hz, 20));
    if (x <= logF[0]) mag[k] = ctrlDb[0];
    else if (x >= logF[logF.length - 1]) mag[k] = ctrlDb[ctrlDb.length - 1];
    else {
      let lo = 0;
      while (logF[lo + 1] < x) lo++;
      const t = (x - logF[lo]) / (logF[lo + 1] - logF[lo]);
      const db = ctrlDb[lo] * (1 - t) + ctrlDb[lo + 1] * t;
      mag[k] = Math.pow(10, db / 20);
    }
  }
  return mag;
}

/** 由期望幅度响应设计加窗 FIR（长度 firLen，奇数） */
function designFir(desiredMag: Float64Array, firLen: number): Float64Array {
  const n = desiredMag.length; // 单边点数
  const nfft = (n - 1) * 2;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  re[0] = desiredMag[0];
  for (let k = 1; k < n; k++) {
    re[k] = desiredMag[k];
    re[nfft - k] = desiredMag[k];
  }
  // IFFT
  for (let k = 0; k < nfft; k++) im[k] = -im[k];
  fft(re, im);
  for (let i = 0; i < nfft; i++) re[i] /= nfft;

  // fftshift 后截取中间 firLen 点并加 Hann 窗
  const fir = new Float64Array(firLen);
  const start = nfft / 2 - Math.floor(firLen / 2);
  const win = hann(firLen);
  for (let i = 0; i < firLen; i++) fir[i] = re[(start + i) % nfft] * win[i];
  return fir;
}

/** 重叠相加 FFT 卷积 */
function convolveOla(signal: Float64Array, fir: Float64Array): Float64Array {
  const m = fir.length;
  const block = 4096;
  const nfft = 1;
  let fftN = 1;
  while (fftN < block + m - 1) fftN <<= 1;
  void nfft;

  const firRe = new Float64Array(fftN);
  const firIm = new Float64Array(fftN);
  firRe.set(fir);
  fft(firRe, firIm);

  const out = new Float64Array(signal.length + m - 1);
  for (let start = 0; start < signal.length; start += block) {
    const re = new Float64Array(fftN);
    const im = new Float64Array(fftN);
    const len = Math.min(block, signal.length - start);
    re.set(signal.subarray(start, start + len));
    fft(re, im);
    for (let k = 0; k < fftN; k++) {
      const rr = re[k] * firRe[k] - im[k] * firIm[k];
      const ii = re[k] * firIm[k] + im[k] * firRe[k];
      re[k] = rr;
      im[k] = ii;
    }
    for (let k = 0; k < fftN; k++) im[k] = -im[k];
    fft(re, im);
    for (let i = 0; i < fftN && start + i < out.length; i++) {
      out[start + i] += re[i] / fftN;
    }
  }
  return out.subarray(0, signal.length);
}

/** 麦克风频响：FIR 幅度整形 + 一阶低频切除 */
function applyMicResponse(sig: Float64Array, p: DeviceParams): Float64Array {
  const fftN = 2048;
  const mag = interpDbToLinear(p.micCtrlFreq, p.micCtrlDb, fftN / 2 + 1, p.sampleRate / 2);
  // 折叠低频切除
  const rc = 1 / (2 * Math.PI * p.micLowCutHz);
  for (let k = 0; k < mag.length; k++) {
    const hz = (k / (mag.length - 1)) * (p.sampleRate / 2);
    const hp = (2 * Math.PI * hz * rc) / Math.sqrt(1 + (2 * Math.PI * hz * rc) ** 2);
    mag[k] *= hp;
  }
  const fir = designFir(mag, 513);
  let out = convolveOla(sig, fir);
  const hp = new HighPass1(p.micLowCutHz, p.sampleRate);
  out = hp.filter(out);
  return out;
}

/** 有色本底噪声：白噪声经低频搁架（一阶低通混合） */
function generateNoise(length: number, p: DeviceParams, rng: Rng): Float64Array {
  const white = new Float64Array(length);
  for (let i = 0; i < length; i++) white[i] = rng.gaussian();
  const lp = new LowPass1(p.noiseShelfHz, p.sampleRate);
  const low = lp.filter(white);
  const shelfAmp = Math.pow(10, p.noiseShelfDb / 20) - 1;
  const baseAmp = Math.pow(10, p.noiseLevelDb / 20);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = baseAmp * (white[i] + shelfAmp * low[i]);
  }
  return out;
}

/** 自动增益控制：20ms 帧电平检测，指数平滑增益，软限幅 */
function applyAgc(sig: Float64Array, p: DeviceParams): Float64Array {
  const frameLen = Math.floor(0.02 * p.sampleRate);
  const target = Math.pow(10, p.agcTargetDb / 20);
  const maxGain = Math.pow(10, p.agcMaxGainDb / 20);
  const attackCoeff = Math.exp(-1 / (p.agcAttackSec * p.sampleRate / frameLen));
  const releaseCoeff = Math.exp(-1 / (p.agcReleaseSec * p.sampleRate / frameLen));

  const gains = new Float64Array(Math.ceil(sig.length / frameLen));
  let smoothedGain = 1;
  for (let f = 0; f < gains.length; f++) {
    let energy = 0;
    const start = f * frameLen;
    const end = Math.min(start + frameLen, sig.length);
    for (let i = start; i < end; i++) energy += sig[i] * sig[i];
    const rms = Math.sqrt(energy / (end - start));
    const desired = rms > 1e-6 ? Math.min(maxGain, target / rms) : maxGain;
    const coeff = desired < smoothedGain ? attackCoeff : releaseCoeff;
    smoothedGain = coeff * smoothedGain + (1 - coeff) * desired;
    gains[f] = smoothedGain;
  }

  const out = new Float64Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    const f = Math.floor(i / frameLen);
    const frac = (i % frameLen) / frameLen;
    const g0 = gains[f];
    const g1 = gains[Math.min(f + 1, gains.length - 1)];
    const g = g0 * (1 - frac) + g1 * frac;
    // tanh 软限幅
    const v = sig[i] * g;
    out[i] = Math.tanh(v * 1.5) / Math.tanh(1.5);
  }
  return out;
}

/** 编码器模拟：多阶一阶低通级联 + 16bit 均匀量化 */
function applyEncoder(sig: Float64Array, p: DeviceParams): Float64Array {
  // 一阶节级联的 -3dB 频率会偏低，按级数修正每节 fc
  const correction = Math.sqrt(Math.pow(2, 1 / p.cutoffStages) - 1);
  const stageFc = p.cutoffHz * correction;
  let out = sig;
  for (let s = 0; s < p.cutoffStages; s++) {
    const lp = new LowPass1(stageFc, p.sampleRate);
    out = lp.filter(out);
  }
  // 16bit PCM 量化
  const q = 32768;
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(-1, Math.min(1, out[i]));
    out[i] = Math.round(out[i] * q) / q;
  }
  return out;
}

/**
 * 在型号模板上实例化一台具体设备（个体抖动）。
 * @param unitSeed 个体种子：同一种子永远生成同一台设备
 */
export function instantiateUnit(template: DeviceParams, unitSeed: number): DeviceParams {
  const rng = new Rng(unitSeed);
  const jitter = (sd: number) => rng.gaussian() * sd;

  return {
    ...template,
    micCtrlDb: template.micCtrlDb.map((db) => db + jitter(1.1)),
    micLowCutHz: template.micLowCutHz * rng.uniform(0.88, 1.14),
    noiseLevelDb: template.noiseLevelDb + jitter(2.5),
    noiseShelfDb: template.noiseShelfDb + jitter(1.5),
    noiseShelfHz: template.noiseShelfHz * rng.uniform(0.85, 1.18),
    agcTargetDb: template.agcTargetDb + jitter(1.6),
    agcAttackSec: template.agcAttackSec * Math.pow(2, jitter(0.35)),
    agcReleaseSec: template.agcReleaseSec * Math.pow(2, jitter(0.35)),
    agcMaxGainDb: template.agcMaxGainDb + jitter(1.5),
    cutoffHz: template.cutoffHz * rng.uniform(0.97, 1.03),
  };
}

/** 按给定设备参数合成一段录音（内容由 contentSeed 决定） */
export function synthesize(
  params: DeviceParams,
  durationSec: number,
  contentSeed: number,
): { signal: Float64Array; sampleRate: number } {
  const rng = new Rng(contentSeed);
  const sr = params.sampleRate;

  let sig = generateSpeech(durationSec, sr, rng);
  sig = applyMicResponse(sig, params);

  const noise = generateNoise(sig.length, params, rng);
  for (let i = 0; i < sig.length; i++) sig[i] += noise[i];

  sig = applyAgc(sig, params);
  sig = applyEncoder(sig, params);

  // 防止极值
  for (let i = 0; i < sig.length; i++) sig[i] = Math.max(-1, Math.min(1, sig[i]));
  return { signal: sig, sampleRate: sr };
}

/** 便捷封装：模板序号 + 个体种子 + 内容种子 */
export function synthesizeByTemplate(
  templateIndex: number,
  unitSeed: number,
  contentSeed: number,
  durationSec: number,
): { signal: Float64Array; sampleRate: number; params: DeviceParams } {
  const template = DEVICE_TEMPLATES[templateIndex];
  const params = instantiateUnit(template, unitSeed);
  const { signal, sampleRate } = synthesize(params, durationSec, contentSeed);
  return { signal, sampleRate, params };
}

// 供频响分析工具复用
export { applyMagnitudeResponse };

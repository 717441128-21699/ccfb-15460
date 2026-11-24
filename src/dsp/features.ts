/**
 * 设备指纹特征提取。
 *
 * 四类特征（全部只依赖设备链路、不依赖说话内容）：
 *  1. 频响形状 frequencyResponse —— 对数频带相对谱（去除内容谱与总增益）
 *  2. 本底噪声谱 noiseFloor —— 低能量帧的中位数功率，按内容总能量归一化
 *  3. AGC 行为 agc —— 帧电平分布与包络时间常数
 *  4. 编码器截止 cutoff —— 高频能量边缘位置
 */
import { powerSpectrum } from './fft.ts';
import { hann } from './windows.ts';

export const FFT_SIZE = 2048;
export const HOP_DIV = 2; // 50% 重叠
export const N_BANDS = 40;
export const FRAME_DB_MIN = -90;

export interface AgcFeature {
  /** 帧 RMS 的 10/25/50/75/90 百分位（dBFS） */
  levelPercentiles: number[];
  /** 帧电平标准差（dB） */
  levelStd: number;
  /** 包络上升时间常数（帧）与下降时间常数（帧） */
  attackTau: number;
  releaseTau: number;
  /** 顶部 5% 帧的平均电平（dBFS），反映限幅/目标电平 */
  headroom: number;
}

export interface DeviceFingerprint {
  /** 特征结构版本号 */
  version: 1;
  sampleRate: number;
  fftSize: number;
  nBands: number;
  /** 每个对数频带的中心频率（Hz），便于跨采样率比对 */
  bandCenters: number[];
  /** 频响曲线形状：各频带相对全带中位数的 dB 值，再整体去均值 */
  frequencyResponse: number[];
  /** 本底噪声：静音帧各频带中位数功率（dB），减去信号带内中位电平做归一化 */
  noiseFloor: number[];
  /** 噪声谱形状（去均值），与噪声绝对电平解耦 */
  noiseShape: number[];
  /** AGC / 动态特征 */
  agc: AgcFeature;
  /** 编码器高频截止估计（Hz）；无法判定时为 null */
  cutoffHz: number | null;
  /** 截止带边缘斜率（dB/倍频程） */
  cutoffSlope: number;
  /** 分析使用的帧数与静音帧数 */
  frameCount: number;
  silenceFrameCount: number;
  /** 带内中位电平（dBFS），归一化基准，仅记录不参与距离 */
  referenceLevel: number;
}

/** 构造对数等距频带边界（下限保证每带至少约 3 个 FFT bin，上限贴近奈奎斯特） */
export function makeLogBands(sampleRate: number, nBands: number = N_BANDS): { edges: number[]; centers: number[] } {
  const binHz = sampleRate / FFT_SIZE;
  const fMin = Math.max(100, binHz * 3);
  const fMax = sampleRate * 0.495;
  const edges: number[] = [];
  const centers: number[] = [];
  for (let b = 0; b <= nBands; b++) {
    const t = b / nBands;
    edges.push(fMin * Math.pow(fMax / fMin, t));
  }
  for (let b = 0; b < nBands; b++) {
    centers.push(Math.sqrt(edges[b] * edges[b + 1]));
  }
  return { edges, centers };
}

function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function sortedCopy(x: number[]): number[] {
  return x.slice().sort((a, b) => a - b);
}

function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

function std(x: ArrayLike<number>, mu: number): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - mu) * (x[i] - mu);
  return Math.sqrt(s / x.length);
}

/** 分帧：Hann 窗、50% 重叠，返回加窗帧与帧 RMS */
function frameSignal(signal: Float64Array, fftSize: number): { frames: Float64Array[]; rmsDb: number[] } {
  const hop = fftSize / HOP_DIV;
  const win = hann(fftSize);
  const frames: Float64Array[] = [];
  const rmsDb: number[] = [];
  const nFrames = Math.max(0, Math.floor((signal.length - fftSize) / hop) + 1);

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    const frame = new Float64Array(fftSize);
    let energy = 0;
    for (let i = 0; i < fftSize; i++) {
      const v = signal[start + i] * win[i];
      frame[i] = v;
      energy += v * v;
    }
    frames.push(frame);
    const rms = Math.sqrt(energy / fftSize);
    rmsDb.push(20 * Math.log10(Math.max(rms, 1e-7)));
  }
  return { frames, rmsDb };
}

/** 把线性 FFT 功率谱汇聚到对数频带（dB） */
function bandEnergies(power: Float64Array, sampleRate: number, edges: number[]): number[] {
  const nBins = power.length;
  const binHz = sampleRate / 2 / (nBins - 1);
  const bands = new Array<number>(edges.length - 1).fill(0);
  const counts = new Array<number>(edges.length - 1).fill(0);

  for (let k = 1; k < nBins; k++) {
    const hz = k * binHz;
    // 二分查找频带
    let lo = 0;
    let hi = edges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (edges[mid + 1] < hz) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= bands.length) continue;
    if (hz < edges[lo] || hz >= edges[lo + 1]) continue;
    bands[lo] += power[k];
    counts[lo]++;
  }
  return bands.map((p, i) => 10 * Math.log10(Math.max(p / Math.max(counts[i], 1), 1e-20)));
}

/**
 * 编码器高频截止估计（基于本底噪声谱，与说话内容无关）。
 *
 * 噪声谱 = 麦克风频响 × 编码器低通。先在 1.5~4kHz 通带段对噪声 dB 曲线
 * 做线性拟合（对数频率轴），得到仅含麦克风趋势的外推基线；编码器低通使实测曲线在高频持续偏离外推线。取残差
 * （实测 - 外推）越过 -3dB 的位置作为截止特征频率，并在相邻频带间做
 * 对数频率插值。该特征用于设备间一致性比对，不追求与标称截止频率的
 * 绝对重合。同时要求最陡 4 窗口平台相对通带斜率变陡 ≥4dB/oct
 * 且平台均值 ≤-6.5dB/oct，否则认为不存在可与麦克风区分的编码器拐点，
 * 返回 null（如单阶高截止、分析频带不足），由比对引擎中性处理。
 */
function estimateCutoffFromNoise(noiseDb: number[], centers: number[]): { hz: number | null; slope: number } {
  const n = noiseDb.length;
  if (n < 14) return { hz: null, slope: 0 };

  const smooth = noiseDb.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    let s = 0;
    for (let k = lo; k <= hi; k++) s += noiseDb[k];
    return s / (hi - lo + 1);
  });
  const x = centers.map((f) => Math.log2(f));

  const fitLine = (lo: number, hi: number): { m: number; b: number } => {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    const cnt = hi - lo + 1;
    for (let i = lo; i <= hi; i++) {
      sx += x[i];
      sy += smooth[i];
      sxx += x[i] * x[i];
      sxy += x[i] * smooth[i];
    }
    const mx = sx / cnt;
    const my = sy / cnt;
    const den = sxx - cnt * mx * mx;
    const m = den === 0 ? 0 : (sxy - cnt * mx * my) / den;
    return { m, b: my - m * mx };
  };

  const i1 = centers.findIndex((f) => f >= 1500);
  const i2 = centers.findIndex((f) => f >= 4000);
  if (i1 < 0 || i2 - i1 < 4) return { hz: null, slope: 0 };
  const pass = fitLine(i1, i2);

  // 残差曲线
  const resid = smooth.map((v, i) => v - (pass.m * x[i] + pass.b));

  // 局部斜率（用于平台确认）
  const localSlope = new Array<number>(n - 1).fill(0);
  for (let i = 0; i < localSlope.length; i++) {
    localSlope[i] = (smooth[i + 1] - smooth[i]) / (x[i + 1] - x[i]);
  }
  const win = 4;
  let bestMean = 0;
  for (let i = i2; i + win <= localSlope.length; i++) {
    let sum = 0;
    for (let k = 0; k < win; k++) sum += localSlope[i + k];
    const m = sum / win;
    if (m < bestMean) bestMean = m;
  }
  if (pass.m - bestMean < 4 || bestMean > -6.5) return { hz: null, slope: 0 };

  // 残差越过 -3dB 的首个频带
  const searchFrom = Math.max(i2, centers.findIndex((c) => c >= 2500));
  let cross = -1;
  for (let i = searchFrom; i < n - 1; i++) {
    if (resid[i] <= -3) {
      cross = i;
      break;
    }
  }
  if (cross <= 0) return { hz: null, slope: 0 };
  // 末端必须仍在走低，排除随机波动造成的假跨越
  if (resid[n - 1] > resid[cross] - 1) return { hz: null, slope: 0 };

  // 在 cross-1 与 cross 之间对残差插值到 -3dB（对数频率）
  const r1 = resid[cross - 1];
  const r2 = resid[cross];
  const t = r2 === r1 ? 0.5 : (-3 - r1) / (r2 - r1);
  const hz = centers[cross - 1] * Math.pow(centers[cross] / centers[cross - 1], Math.min(1, Math.max(0, t)));
  return { hz, slope: bestMean };
}


/** 一阶时间常数拟合：从电平包络的自相关衰减估计 */
function envelopeTau(levelsDb: number[], rising: boolean): number {
  if (levelsDb.length < 20) return 0;
  const env: number[] = [];
  let e = levelsDb[0];
  for (const x of levelsDb) {
    if (rising ? x > e : x < e) e = x; // 峰值/谷值保持方向
    env.push(e);
  }
  // 对相应方向的变化段做指数拟合：y(t)=A*exp(-t/tau)
  const diffs: Array<[number, number]> = [];
  for (let i = 1; i < env.length; i++) {
    const d = env[i] - env[i - 1];
    if (rising ? d > 0.05 : d < -0.05) {
      diffs.push([i, Math.abs(env[i] - env[0])]);
    }
  }
  if (diffs.length < 8) return rising ? 3 : 30;
  // 线性拟合 log(y) ~ t
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [t, y] of diffs) {
    if (y > 0.5) {
      xs.push(t);
      ys.push(Math.log(y));
    }
  }
  if (xs.length < 8) return rising ? 3 : 30;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0 || num >= 0) return rising ? 3 : 30;
  const tau = -1 / (num / den);
  return Math.min(200, Math.max(0.5, tau));
}

/**
 * 主入口：从 PCM 信号提取设备指纹。
 * @param signal 单声道 PCM，范围 [-1, 1)
 * @param sampleRate 采样率（Hz）
 */
export function extractFingerprint(signal: Float64Array, sampleRate: number): DeviceFingerprint {
  if (signal.length < FFT_SIZE * 4) {
    throw new Error('音频过短，至少需要数秒有效录音才能提取指纹');
  }

  const { edges, centers } = makeLogBands(sampleRate, N_BANDS);
  const { frames, rmsDb } = frameSignal(signal, FFT_SIZE);

  const levelSorted = sortedCopy(rmsDb);
  const p10 = percentile(levelSorted, 10);
  const p25 = percentile(levelSorted, 25);
  const p50 = percentile(levelSorted, 50);
  const p75 = percentile(levelSorted, 75);
  const p90 = percentile(levelSorted, 90);
  const refLevel = p50;

  // 静音帧：电平低于 25 分位 - 6dB（取较低的 15% 帧，保证样本量）
  const silenceThreshold = percentile(levelSorted, 15);
  const silenceIdx: number[] = [];
  for (let f = 0; f < rmsDb.length; f++) {
    if (rmsDb[f] <= silenceThreshold) silenceIdx.push(f);
  }

  // 各帧频带能量矩阵
  const bandMatrix: number[][] = new Array(frames.length);
  for (let f = 0; f < frames.length; f++) {
    const power = powerSpectrum(frames[f]);
    bandMatrix[f] = bandEnergies(power, sampleRate, edges);
  }

  // —— 特征 1：频响形状 ——
  // 每个频带取 60 分位能量（抑制语音稀疏性与静音帧影响），再去全带均值
  const fr: number[] = new Array(N_BANDS);
  for (let b = 0; b < N_BANDS; b++) {
    const col = new Array<number>(frames.length);
    for (let f = 0; f < frames.length; f++) col[f] = bandMatrix[f][b];
    col.sort((a, b2) => a - b2);
    fr[b] = percentile(col, 60);
  }
  const frMean = mean(fr);
  const frequencyResponse = fr.map((v) => v - frMean);

  // —— 特征 2：本底噪声谱 ——
  // 逐频带取全时段 20 分位能量：语音在时频面上稀疏，低分位贴近设备本底噪声，
  // 且不依赖"哪些帧是静音"的硬判定，对不同说话内容更稳健。
  const noiseRaw: number[] = new Array(N_BANDS);
  for (let b = 0; b < N_BANDS; b++) {
    const col = new Array<number>(frames.length);
    for (let f = 0; f < frames.length; f++) col[f] = bandMatrix[f][b];
    col.sort((a, b2) => a - b2);
    noiseRaw[b] = percentile(col, 20) - refLevel;
  }
  const noiseMean = mean(noiseRaw);
  const noiseShape = noiseRaw.map((v) => v - noiseMean);

  // —— 特征 3：AGC ——
  const levelMu = mean(rmsDb);
  const top5: number[] = [];
  const topThreshold = percentile(levelSorted, 95);
  for (const v of rmsDb) if (v >= topThreshold) top5.push(v);
  const agc: AgcFeature = {
    levelPercentiles: [p10, p25, p50, p75, p90],
    levelStd: std(rmsDb, levelMu),
    attackTau: envelopeTau(rmsDb, true),
    releaseTau: envelopeTau(rmsDb, false),
    headroom: mean(top5),
  };

  // —— 特征 4：编码器截止（基于本底噪声谱，与语音内容无关）——
  const { hz: cutoffHz, slope: cutoffSlope } = estimateCutoffFromNoise(noiseRaw, centers);

  return {
    version: 1,
    sampleRate,
    fftSize: FFT_SIZE,
    nBands: N_BANDS,
    bandCenters: centers,
    frequencyResponse,
    noiseFloor: noiseRaw,
    noiseShape,
    agc,
    cutoffHz,
    cutoffSlope,
    frameCount: frames.length,
    silenceFrameCount: silenceIdx.length,
    referenceLevel: refLevel,
  };
}

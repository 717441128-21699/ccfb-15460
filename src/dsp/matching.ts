/**
 * 指纹比对：多特征加权距离 + 相似度评分。
 * 距离各分量先按物理尺度归一化，再加权求和，最后映射为 0~100 的相似度。
 * 支持不同采样率的指纹互比（对数频率轴插值）。
 */
import type { DeviceFingerprint } from './features.ts';

export interface MatchComponent {
  name: string;
  /** 归一化距离，越小越相似 */
  distance: number;
  weight: number;
  detail: string;
}

export interface MatchResult {
  deviceId: string;
  deviceName: string;
  model: string;
  totalDistance: number;
  /** 0~100 相似度 */
  score: number;
  rank: number;
  components: MatchComponent[];
}

export const WEIGHTS = {
  frequencyResponse: 0.34,
  noise: 0.3,
  agc: 0.21,
  cutoff: 0.15,
} as const;

/** 在对数频率轴上把 src 的 dB 曲线插值到目标中心频率 */
function resampleLog(
  srcCenters: number[],
  srcValues: number[],
  dstCenters: number[],
): { values: number[]; valid: boolean[] } {
  const n = dstCenters.length;
  const values = new Array<number>(n).fill(0);
  const valid = new Array<boolean>(n).fill(false);
  const logSrc = srcCenters.map((f) => Math.log(f));
  const logDst = dstCenters.map((f) => Math.log(f));

  for (let i = 0; i < n; i++) {
    const x = logDst[i];
    if (x < logSrc[0] || x > logSrc[logSrc.length - 1]) continue;
    let lo = 0;
    let hi = logSrc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (logSrc[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - logSrc[lo]) / (logSrc[hi] - logSrc[lo]);
    values[i] = srcValues[lo] * (1 - t) + srcValues[hi] * t;
    valid[i] = true;
  }
  return { values, valid };
}

function rmseValid(a: number[], b: number[], valid: boolean[]): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (!valid[i]) continue;
    const d = a[i] - b[i];
    s += d * d;
    n++;
  }
  return n > 0 ? Math.sqrt(s / n) : 0;
}

function meanValid(a: number[], valid: boolean[]): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (valid[i]) {
      s += a[i];
      n++;
    }
  }
  return n ? s / n : 0;
}

export interface DeviceRecord {
  id: string;
  name: string;
  model: string;
  fingerprint: DeviceFingerprint;
  createdAt: number;
  note?: string;
}

/** 计算两个指纹之间的全部分量距离 */
export function compareFingerprints(query: DeviceFingerprint, ref: DeviceFingerprint): {
  totalDistance: number;
  components: MatchComponent[];
} {
  // 以参考指纹的频带轴为基准，重采样检材曲线
  const frRs = resampleLog(query.bandCenters, query.frequencyResponse, ref.bandCenters);
  const nsRs = resampleLog(query.bandCenters, query.noiseShape, ref.bandCenters);
  const nfRs = resampleLog(query.bandCenters, query.noiseFloor, ref.bandCenters);

  // —— 频响形状：6dB 尺度归一 ——
  const dFr = rmseValid(frRs.values, ref.frequencyResponse, frRs.valid) / 6;

  // —— 本底噪声：形状 6dB + 绝对电平 10dB ——
  const dNoiseShape = rmseValid(nsRs.values, ref.noiseShape, nsRs.valid) / 6;
  const qNoiseLevel = meanValid(nfRs.values, nfRs.valid);
  const rNoiseLevel = meanValid(ref.noiseFloor, nfRs.valid);
  const dNoiseLevel = Math.abs(qNoiseLevel - rNoiseLevel) / 10;
  const dNoise = Math.sqrt((dNoiseShape * dNoiseShape + dNoiseLevel * dNoiseLevel) / 2);

  // —— AGC / 动态 ——
  const qp = query.agc.levelPercentiles;
  const rp = ref.agc.levelPercentiles;
  const shapeDiffs: number[] = [];
  // 百分位形状（相对中位数），尺度 8dB
  for (const idx of [0, 1, 3, 4]) {
    shapeDiffs.push((qp[idx] - qp[2] - (rp[idx] - rp[2])) / 8);
  }
  const dPctShape = Math.sqrt(shapeDiffs.reduce((s, x) => s + x * x, 0) / shapeDiffs.length);
  const dStd = Math.abs(query.agc.levelStd - ref.agc.levelStd) / 6;
  const dAttack = Math.abs(Math.log(Math.max(query.agc.attackTau, 0.5) / Math.max(ref.agc.attackTau, 0.5))) / Math.log(2);
  const dRelease = Math.abs(Math.log(Math.max(query.agc.releaseTau, 0.5) / Math.max(ref.agc.releaseTau, 0.5))) / Math.log(2);
  const dHeadroom = Math.abs(query.agc.headroom - ref.agc.headroom) / 10;
  const dAgc = Math.sqrt(
    (dPctShape ** 2 + dStd ** 2 + dAttack ** 2 + dRelease ** 2 + dHeadroom ** 2) / 5,
  );

  // —— 编码器截止 ——
  let dCutoff: number;
  let cutoffDetail: string;
  if (query.cutoffHz != null && ref.cutoffHz != null) {
    const rel = Math.abs(query.cutoffHz - ref.cutoffHz) / Math.max(query.cutoffHz, ref.cutoffHz);
    dCutoff = rel / 0.05; // 5% 相对偏差为一个归一化单位
    cutoffDetail = `${Math.round(query.cutoffHz)}Hz vs ${Math.round(ref.cutoffHz)}Hz，相对偏差 ${(rel * 100).toFixed(1)}%`;
  } else if (query.cutoffHz == null && ref.cutoffHz == null) {
    dCutoff = 0;
    cutoffDetail = '两者均未检测到明显高频截止';
  } else {
    dCutoff = 0.4;
    cutoffDetail = '仅一方检测到截止特征，按中性偏差处理';
  }

  const components: MatchComponent[] = [
    {
      name: '频响曲线',
      distance: dFr,
      weight: WEIGHTS.frequencyResponse,
      detail: `归一化 RMSE=${dFr.toFixed(3)}（原始 ${(dFr * 6).toFixed(2)}dB）`,
    },
    {
      name: '本底噪声',
      distance: dNoise,
      weight: WEIGHTS.noise,
      detail: `形状 ${dNoiseShape.toFixed(3)} / 电平 ${dNoiseLevel.toFixed(3)}`,
    },
    {
      name: 'AGC 动态',
      distance: dAgc,
      weight: WEIGHTS.agc,
      detail: `百分位形状 ${dPctShape.toFixed(3)}，时间常数偏差 ${dAttack.toFixed(2)}/${dRelease.toFixed(2)}`,
    },
    {
      name: '编码截止',
      distance: dCutoff,
      weight: WEIGHTS.cutoff,
      detail: cutoffDetail,
    },
  ];

  const totalDistance =
    dFr * WEIGHTS.frequencyResponse +
    dNoise * WEIGHTS.noise +
    dAgc * WEIGHTS.agc +
    dCutoff * WEIGHTS.cutoff;

  return { totalDistance, components };
}

/** 距离 → 0~100 相似度（指数映射，同机录音通常落在 85+） */
export function distanceToScore(distance: number): number {
  const score = 100 * Math.exp(-distance);
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

/** 检材指纹对设备库逐个比对，按相似度降序排名 */
export function compareBatch(query: DeviceFingerprint, library: DeviceRecord[]): MatchResult[] {
  const results = library.map((rec) => {
    const { totalDistance, components } = compareFingerprints(query, rec.fingerprint);
    return {
      deviceId: rec.id,
      deviceName: rec.name,
      model: rec.model,
      totalDistance,
      score: distanceToScore(totalDistance),
      rank: 0,
      components,
    };
  });
  results.sort((a, b) => a.totalDistance - b.totalDistance);
  results.forEach((r, i) => {
    r.rank = i + 1;
  });
  return results;
}

/** 鉴定意见分级（基于 Top1 分数及与第二名的差距） */
export function conclude(results: MatchResult[]): { level: string; advice: string } {
  if (results.length === 0) {
    return { level: '无法判断', advice: '设备库为空，请先建设备指纹。' };
  }
  const top = results[0];
  const gap = results.length > 1 ? top.score - results[1].score : top.score;
  if (top.score >= 80 && gap >= 8) {
    return {
      level: '强烈支持同一设备',
      advice: `Top1 相似度 ${top.score}，领先第二名 ${gap.toFixed(1)} 分，特征一致性高。`,
    };
  }
  if (top.score >= 65 && gap >= 5) {
    return {
      level: '倾向同一设备',
      advice: `Top1 相似度 ${top.score}，领先第二名 ${gap.toFixed(1)} 分，建议结合更多检材复核。`,
    };
  }
  if (top.score >= 50) {
    return {
      level: '不能作出同一认定',
      advice: `最高相似度仅 ${top.score}，特征区分度不足，建议补充参考录音或扩大设备库。`,
    };
  }
  return {
    level: '倾向排除',
    advice: `检材与库中所有设备相似度均较低（最高 ${top.score}），未见匹配设备。`,
  };
}

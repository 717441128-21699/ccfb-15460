/**
 * 指标评测：
 *  A. 同型号不同个体可分率（≥80%）——同一设备的不同录音应互相最相似
 *  B. 不同型号识别准确率（≥95%）——检材的 Top1 设备应来自正确型号
 *  C. 性能——5 分钟检材 × 500 台指纹的比对耗时（≤10s）
 */
import { DEVICE_TEMPLATES, instantiateUnit, synthesize } from './synth.ts';
import { extractFingerprint, type DeviceFingerprint } from './features.ts';
import { compareBatch, type DeviceRecord } from './matching.ts';
import { Rng } from './rng.ts';

export interface EvalResult {
  // A 个体可分率
  unitTotal: number;
  unitPass: number;
  unitRate: number;
  // B 型号识别
  modelTotal: number;
  modelPass: number;
  modelRate: number;
  // C 性能
  librarySize: number;
  evidenceSeconds: number;
  extractMs: number;
  compareMs: number;
  totalMs: number;
  targetMs: number;
  // 明细
  unitDetails: Array<{ template: string; unit: number; rank: number; topScore: number; pass: boolean }>;
  modelDetails: Array<{ template: string; rank: number; topModel: string; pass: boolean }>;
}

interface UnitEntry {
  templateIndex: number;
  unitIndex: number;
  unitSeed: number;
  refFp: DeviceFingerprint;
  queryFp: DeviceFingerprint;
}

function buildUnitEntries(unitsPerModel: number, refSec: number, querySec: number, rng: Rng): UnitEntry[] {
  const entries: UnitEntry[] = [];
  for (let t = 0; t < DEVICE_TEMPLATES.length; t++) {
    for (let u = 0; u < unitsPerModel; u++) {
      const unitSeed = 1000 + t * 10000 + u * 137;
      const params = instantiateUnit(DEVICE_TEMPLATES[t], unitSeed);
      // 参考录音与检材内容完全不同（独立内容种子）
      const ref = synthesize(params, refSec, rng.nextInt());
      const qry = synthesize(params, querySec, rng.nextInt());
      entries.push({
        templateIndex: t,
        unitIndex: u,
        unitSeed,
        refFp: extractFingerprint(ref.signal, ref.sampleRate),
        queryFp: extractFingerprint(qry.signal, qry.sampleRate),
      });
    }
  }
  return entries;
}

export function runEvaluation(opts: {
  unitsPerModel?: number;
  refSeconds?: number;
  querySeconds?: number;
  performanceLibrary?: number;
  evidenceSeconds?: number;
  onProgress?: (msg: string) => void;
} = {}): EvalResult {
  const unitsPerModel = opts.unitsPerModel ?? 6;
  const refSec = opts.refSeconds ?? 30;
  const querySec = opts.querySeconds ?? 20;
  const perfLib = opts.performanceLibrary ?? 500;
  const evidenceSec = opts.evidenceSeconds ?? 300;
  const progress = opts.onProgress ?? (() => {});
  const rng = new Rng(20261125);

  progress('生成各设备参考/检材录音并提取指纹…');
  const entries = buildUnitEntries(unitsPerModel, refSec, querySec, rng);

  // 设备库：每条 entry 贡献一台参考设备
  const library: DeviceRecord[] = entries.map((e, i) => ({
    id: `dev_${i}`,
    name: `${DEVICE_TEMPLATES[e.templateIndex].modelName} #${e.unitIndex + 1}`,
    model: DEVICE_TEMPLATES[e.templateIndex].modelName,
    fingerprint: e.refFp,
    createdAt: 0,
  }));

  // —— A 个体可分率：检材在全库中的 Top1 是否为同一台设备 ——
  progress('比对全部检材（个体可分率 + 型号准确率）…');
  const unitDetails: EvalResult['unitDetails'] = [];
  const modelDetails: EvalResult['modelDetails'] = [];
  let unitPass = 0;
  let modelPass = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const results = compareBatch(e.queryFp, library);
    const top = results[0];
    const correctRank = results.find((r) => r.deviceId === `dev_${i}`)?.rank ?? results.length + 1;
    const sameUnit = top.deviceId === `dev_${i}`;
    if (sameUnit) unitPass++;
    const correctModel = top.model === DEVICE_TEMPLATES[e.templateIndex].modelName;
    if (correctModel) modelPass++;

    unitDetails.push({
      template: DEVICE_TEMPLATES[e.templateIndex].modelName,
      unit: e.unitIndex + 1,
      rank: correctRank,
      topScore: top.score,
      pass: sameUnit,
    });
    modelDetails.push({
      template: DEVICE_TEMPLATES[e.templateIndex].modelName,
      rank: top.rank,
      topModel: top.model,
      pass: correctModel,
    });
  }

  // —— C 性能：5 分钟检材 × 500 台 ——
  progress(`性能测试：${evidenceSec}s 检材 × ${perfLib} 台指纹…`);
  const perfParams = instantiateUnit(DEVICE_TEMPLATES[0], 999);
  const t0 = performance.now();
  const perfAudio = synthesize(perfParams, evidenceSec, rng.nextInt());
  const t1 = performance.now();
  const perfFp = extractFingerprint(perfAudio.signal, perfAudio.sampleRate);
  const t2 = performance.now();

  const perfLibRecords: DeviceRecord[] = [];
  for (let i = 0; i < perfLib; i++) {
    const t = i % DEVICE_TEMPLATES.length;
    const params = instantiateUnit(DEVICE_TEMPLATES[t], 70000 + i * 31);
    const audio = synthesize(params, 20, rng.nextInt());
    perfLibRecords.push({
      id: `perf_${i}`,
      name: `${DEVICE_TEMPLATES[t].modelName} perf#${i}`,
      model: DEVICE_TEMPLATES[t].modelName,
      fingerprint: extractFingerprint(audio.signal, audio.sampleRate),
      createdAt: 0,
    });
  }
  const t3 = performance.now();
  const perfResults = compareBatch(perfFp, perfLibRecords);
  const t4 = performance.now();
  void perfResults;

  const total = entries.length;
  return {
    unitTotal: total,
    unitPass,
    unitRate: unitPass / total,
    modelTotal: total,
    modelPass,
    modelRate: modelPass / total,
    librarySize: perfLib,
    evidenceSeconds: evidenceSec,
    extractMs: t2 - t1,
    compareMs: t4 - t3,
    totalMs: t4 - t0 - (t3 - t2), // 仅“检材特征提取 + 500 台比对”，不含库构建
    targetMs: 10000,
    unitDetails,
    modelDetails,
  };
}

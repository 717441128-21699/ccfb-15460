/**
 * 端到端流程测试（Node）：
 * 建库 → 合成检材（独立内容）→ WAV 编码/解码往返 → 提取 → 比对 → 报告意见。
 */
import { DEVICE_TEMPLATES, instantiateUnit, synthesize } from '../src/dsp/synth.ts';
import { extractFingerprint } from '../src/dsp/features.ts';
import { compareBatch, conclude, type DeviceRecord } from '../src/dsp/matching.ts';
import { encodeWav, decodeWav } from '../src/dsp/wav.ts';
import { Rng } from '../src/dsp/rng.ts';

const rng = new Rng(777);
const library: DeviceRecord[] = [];

// 1. 建库：5 个型号 × 3 台个体
for (let t = 0; t < 5; t++) {
  for (let u = 0; u < 3; u++) {
    const unitSeed = 1000 + t * 10000 + u * 137;
    const params = instantiateUnit(DEVICE_TEMPLATES[t], unitSeed);
    const ref = synthesize(params, 25, rng.nextInt());
    library.push({
      id: `dev_${t}_${u}`,
      name: `${DEVICE_TEMPLATES[t].modelName} #${u + 1}`,
      model: DEVICE_TEMPLATES[t].modelName,
      fingerprint: extractFingerprint(ref.signal, ref.sampleRate),
      createdAt: 0,
    });
  }
}
console.log(`[1] 设备库建立：${library.length} 台`);

// 2. 目标设备 Boreal 5 #2（t=1,u=1），独立内容种子合成 90 秒检材
const targetT = 1;
const targetU = 1;
const targetParams = instantiateUnit(DEVICE_TEMPLATES[targetT], 1000 + targetT * 10000 + targetU * 137);
const evidence = synthesize(targetParams, 90, rng.nextInt());
console.log(`[2] 检材合成：${evidence.sampleRate}Hz × 90s，目标设备 ${DEVICE_TEMPLATES[targetT].modelName} #${targetU + 1}`);

// 3. WAV 编码 → 解码往返（模拟浏览器文件链路）
const wavBuf = encodeWav(evidence.signal, evidence.sampleRate);
const decoded = decodeWav(wavBuf);
const errMax = decoded.samples.reduce((m, v, i) => Math.max(m, Math.abs(v - evidence.signal[i])), 0);
console.log(`[3] WAV 往返：${wavBuf.byteLength} 字节，16bit 量化最大误差 ${errMax.toExponential(2)}（应 ≈1/32768）`);

// 4. 从解码后的 PCM 提取指纹
const queryFp = extractFingerprint(decoded.samples, decoded.sampleRate);
console.log(`[4] 检材指纹：${queryFp.frameCount} 帧，截止 ${queryFp.cutoffHz ? Math.round(queryFp.cutoffHz) + 'Hz' : '未检出'}`);

// 5. 全库比对
const t0 = performance.now();
const results = compareBatch(queryFp, library);
const t1 = performance.now();
const top = results[0];
const expectedId = `dev_${targetT}_${targetU}`;
console.log(`[5] 比对耗时 ${(t1 - t0).toFixed(1)}ms（${library.length} 台）`);
console.log(`    Top1: ${top.deviceName}（${top.score} 分），期望 ${expectedId}`);
for (const r of results.slice(0, 3)) {
  console.log(`    #${r.rank} ${r.deviceName.padEnd(16)} score=${r.score}  d=${r.totalDistance.toFixed(4)}`);
}

// 6. 鉴定意见
const conclusion = conclude(results);
console.log(`[6] 鉴定意见：${conclusion.level} —— ${conclusion.advice}`);

const ok = top.deviceId === expectedId && errMax < 2e-4;
console.log(ok ? '\n端到端测试通过 ✔' : '\n端到端测试失败 ✘');
process.exit(ok ? 0 : 1);

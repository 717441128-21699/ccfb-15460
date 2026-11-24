/**
 * 多种子稳定性验证：用不同全局种子重复完整评测，检查指标是否稳定达标。
 *   node scripts/stability.ts
 */
import { DEVICE_TEMPLATES, instantiateUnit, synthesize } from '../src/dsp/synth.ts';
import { extractFingerprint } from '../src/dsp/features.ts';
import { compareBatch, type DeviceRecord } from '../src/dsp/matching.ts';
import { Rng } from '../src/dsp/rng.ts';

function trial(seed: number): { unitRate: number; modelRate: number } {
  const rng = new Rng(seed);
  const unitsPerModel = 6;
  const entries = [];
  for (let t = 0; t < DEVICE_TEMPLATES.length; t++) {
    for (let u = 0; u < unitsPerModel; u++) {
      const unitSeed = seed * 7919 + t * 10000 + u * 137;
      const params = instantiateUnit(DEVICE_TEMPLATES[t], unitSeed);
      const ref = synthesize(params, 30, rng.nextInt());
      const qry = synthesize(params, 20, rng.nextInt());
      entries.push({
        t,
        refFp: extractFingerprint(ref.signal, ref.sampleRate),
        qryFp: extractFingerprint(qry.signal, qry.sampleRate),
      });
    }
  }
  const library: DeviceRecord[] = entries.map((e, i) => ({
    id: `dev_${i}`,
    name: `d${i}`,
    model: DEVICE_TEMPLATES[e.t].modelName,
    fingerprint: e.refFp,
    createdAt: 0,
  }));
  let unitPass = 0;
  let modelPass = 0;
  for (let i = 0; i < entries.length; i++) {
    const top = compareBatch(entries[i].qryFp, library)[0];
    if (top.deviceId === `dev_${i}`) unitPass++;
    if (top.model === DEVICE_TEMPLATES[entries[i].t].modelName) modelPass++;
  }
  return { unitRate: unitPass / entries.length, modelRate: modelPass / entries.length };
}

const seeds = [11, 4242, 90001];
let allOk = true;
for (const seed of seeds) {
  const r = trial(seed);
  const ok = r.unitRate >= 0.8 && r.modelRate >= 0.95;
  allOk = allOk && ok;
  console.log(
    `种子 ${seed}: 个体可分率 ${(r.unitRate * 100).toFixed(1)}%（≥80%），型号准确率 ${(r.modelRate * 100).toFixed(1)}%（≥95%） ${ok ? '✔' : '✘'}`,
  );
}
console.log(allOk ? '\n稳定性验证通过' : '\n存在未达标种子');
process.exit(allOk ? 0 : 1);

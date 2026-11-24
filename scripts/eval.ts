/**
 * Node 评测入口：
 *   node scripts/eval.ts          快速冒烟（每型号 3 台、短录音）
 *   node scripts/eval.ts full     完整评测（每型号 6 台 + 5 分钟×500 台性能）
 */
import { runEvaluation, type EvalResult } from '../src/dsp/evaluation.ts';

const full = process.argv.includes('full');

const result: EvalResult = runEvaluation({
  unitsPerModel: full ? 6 : 3,
  refSeconds: full ? 30 : 12,
  querySeconds: full ? 20 : 10,
  performanceLibrary: full ? 500 : 100,
  evidenceSeconds: full ? 300 : 60,
  onProgress: (m) => console.log(`[eval] ${m}`),
});

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ms = (x: number) => `${x.toFixed(0)}ms`;

console.log('\n================ 评测结果 ================');
console.log(`A. 同型号不同个体可分率: ${pct(result.unitRate)}  (${result.unitPass}/${result.unitTotal})  目标 ≥80%`);
console.log(`B. 不同型号识别准确率:   ${pct(result.modelRate)}  (${result.modelPass}/${result.modelTotal})  目标 ≥95%`);
console.log('C. 性能（5 分钟检材 × 500 台，完整模式）:');
console.log(`   检材特征提取: ${ms(result.extractMs)}`);
console.log(`   500 台比对:   ${ms(result.compareMs)}`);
console.log(`   合计:         ${ms(result.totalMs)}  目标 ≤10000ms`);
console.log('\n个体可分率明细（仅列失败项）:');
if (!full) console.log('   （冒烟模式录音仅 10~12 秒，个体特征样本不足，失败项不代表指标口径；完整模式用 20~30 秒录音）');
for (const d of result.unitDetails) {
  if (!d.pass) console.log(`   ✗ ${d.template} #${d.unit} 正确设备排名=${d.rank}  Top1分数=${d.topScore}`);
}
if (result.unitDetails.every((d) => d.pass)) console.log('   全部通过');
console.log('\n型号识别明细（仅列失败项）:');
for (const d of result.modelDetails) {
  if (!d.pass) console.log(`   ✗ ${d.template} 被识别为 ${d.topModel}`);
}
if (result.modelDetails.every((d) => d.pass)) console.log('   全部通过');

const pass =
  (full ? result.unitRate >= 0.8 : true) &&
  (full ? result.modelRate >= 0.95 : true) &&
  (full ? result.totalMs <= result.targetMs : true);
console.log(`\n结论: ${full ? (pass ? '全部达标 ✔' : '存在未达标项 ✘') : '冒烟测试完成（加 full 参数运行完整指标评测）'}`);
process.exit(full && !pass ? 1 : 0);

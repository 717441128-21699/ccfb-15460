/**
 * 评测页：在浏览器内运行准确率与性能指标（与 Node 脚本同一套引擎）。
 */
import { runEvaluation, type EvalResult } from '../../dsp/evaluation.ts';
import { el, clear, showToast } from '../dom.ts';

export function renderEvaluation(container: HTMLElement): void {
  clear(container);
  container.append(
    el('h2', { className: 'page-title' }, '指标评测'),
    el('p', { className: 'page-desc' },
      '基于内置 8 个型号模板的合成录音，验证同型号个体可分率（目标 ≥80%）、型号识别准确率（目标 ≥95%）与 5 分钟检材 × 500 台指纹的比对耗时（目标 ≤10s）。'),
  );

  const panel = el('div', { className: 'panel' });
  const unitsInput = el('input', { type: 'number', value: '6', min: '1', max: '10' }) as HTMLInputElement;
  const btnRun = el('button', { className: 'btn' }, '运行完整评测');
  const log = el('div', { className: 'muted', style: 'font-family:monospace;white-space:pre-wrap;margin-top:12px;min-height:24px;' }, '');
  const resultWrap = el('div', {});

  btnRun.addEventListener('click', async () => {
    btnRun.disabled = true;
    clear(resultWrap);
    log.textContent = '评测运行中，合成与分析需要一些时间…';
    try {
      // 让 UI 先渲染
      await new Promise((r) => setTimeout(r, 30));
      const units = Math.max(1, Math.min(10, Number(unitsInput.value) || 6));
      const result = runEvaluation({
        unitsPerModel: units,
        refSeconds: 30,
        querySeconds: 20,
        performanceLibrary: 500,
        evidenceSeconds: 300,
        onProgress: (m) => { log.textContent = m; },
      });
      log.textContent = '评测完成';
      renderMetrics(resultWrap, result);
      showToast('评测完成');
    } catch (err) {
      log.textContent = '';
      showToast((err as Error).message, true);
    } finally {
      btnRun.disabled = false;
    }
  });

  panel.append(
    el('div', { className: 'row' },
      el('div', { className: 'field' }, el('label', {}, '每型号个体数'), unitsInput),
      btnRun,
    ),
    log, resultWrap,
  );
  container.append(panel);
}

function metricCard(k: string, v: string, ok: boolean, sub: string): HTMLElement {
  return el('div', { className: 'metric' },
    el('div', { className: 'k' }, k),
    el('div', { className: `v ${ok ? 'good' : 'bad'}` }, v),
    el('div', { className: 'muted' }, sub),
  );
}

function renderMetrics(wrap: HTMLElement, r: EvalResult): void {
  clear(wrap);
  const unitOk = r.unitRate >= 0.8;
  const modelOk = r.modelRate >= 0.95;
  const perfOk = r.totalMs <= r.targetMs;

  wrap.append(
    el('div', { className: 'metric-grid', style: 'margin-top:18px' },
      metricCard('同型号个体可分率', `${(r.unitRate * 100).toFixed(1)}%`, unitOk, `${r.unitPass}/${r.unitTotal}，目标 ≥80%`),
      metricCard('型号识别准确率', `${(r.modelRate * 100).toFixed(1)}%`, modelOk, `${r.modelPass}/${r.modelTotal}，目标 ≥95%`),
      metricCard('5分钟检材×500台耗时', `${(r.totalMs / 1000).toFixed(2)}s`, perfOk,
        `提取 ${r.extractMs.toFixed(0)}ms + 比对 ${r.compareMs.toFixed(0)}ms，目标 ≤10s`),
    ),
  );

  const failUnits = r.unitDetails.filter((d) => !d.pass);
  const failModels = r.modelDetails.filter((d) => !d.pass);
  const detail = el('div', { className: 'panel', style: 'margin-top:16px' });
  detail.append(el('h2', {}, '失败明细'));
  if (failUnits.length === 0 && failModels.length === 0) {
    detail.append(el('div', { className: 'empty' }, '全部测试通过 ✔'));
  } else {
    for (const d of failUnits) detail.append(el('p', {}, `个体混淆：${d.template} #${d.unit}，正确设备排名 ${d.rank}，Top1 分数 ${d.topScore}`));
    for (const d of failModels) detail.append(el('p', {}, `型号误判：${d.template} 被识别为 ${d.topModel}`));
  }
  wrap.append(detail);
}

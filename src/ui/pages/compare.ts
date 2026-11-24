/**
 * 检材比对页：导入检材（文件或合成）→ 提取指纹 → 与设备库逐个比对 → 相似度排名。
 */
import { store } from '../../state/store.ts';
import type { CaseRecord } from '../../state/types.ts';
import { extractFingerprint, type DeviceFingerprint } from '../../dsp/features.ts';
import { compareBatch, conclude, type MatchResult } from '../../dsp/matching.ts';
import { loadAudioFile, playAudio, type LoadedAudio } from '../../audio/audioService.ts';
import { DEVICE_TEMPLATES, instantiateUnit, synthesize } from '../../dsp/synth.ts';
import { el, clear, showToast, fmtDuration } from '../dom.ts';
import { fingerprintPanels } from '../fingerprintView.ts';

export function renderCompare(container: HTMLElement, onGoReport: (caseId: string) => void): void {
  clear(container);
  container.append(
    el('h2', { className: 'page-title' }, '检材比对'),
    el('p', { className: 'page-desc' },
      '导入待鉴定录音，提取与说话内容无关的设备特征，与库内全部指纹逐个比对，输出相似度排名与鉴定意见。'),
  );

  if (store.devices.length === 0) {
    container.append(el('div', { className: 'panel empty' },
      '设备库为空，请先到「设备库页」生成合成设备，或在「建模页」建立真实设备指纹。'));
    return;
  }

  // —— 检材获取 ——
  const srcPanel = el('div', { className: 'panel' });
  srcPanel.append(el('h2', {}, '1. 获取检材录音'));

  const caseNameInput = el('input', { type: 'text' }) as HTMLInputElement;
  caseNameInput.placeholder = '案件名称，如：2026-1125 敲诈勒索案语音检材';
  srcPanel.append(el('div', { className: 'field', style: 'margin-bottom:12px;max-width:420px' },
    el('label', {}, '案件名称 *'), caseNameInput));

  const dz = el('div', { className: 'dropzone' },
    el('div', { className: 'big' }, '点击或拖入检材音频'),
    el('div', {}, '比对只使用设备链路特征，检材与参考音说话内容不同不影响判断'),
  );
  const fileInput = el('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a,.ogg', style: 'display:none' }) as HTMLInputElement;
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleFile(f);
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void handleFile(f);
    fileInput.value = '';
  });

  // 合成检材（便于无真实录音时验证流程）
  const synthBox = el('details', {});
  const tplSelect = el('select', {}) as HTMLSelectElement;
  DEVICE_TEMPLATES.forEach((t, i) => tplSelect.append(el('option', { value: String(i) }, `${t.modelName}（${t.sampleRate}Hz，截止 ${t.cutoffHz}Hz）`)));
  const unitInput = el('input', { type: 'number', value: '1', min: '1', max: '30' }) as HTMLInputElement;
  const durInput = el('input', { type: 'number', value: '60', min: '10', max: '300' }) as HTMLInputElement;
  const contentInput = el('input', { type: 'number', value: '31337' }) as HTMLInputElement;
  const btnGen = el('button', { className: 'btn secondary small' }, '合成检材');
  btnGen.addEventListener('click', () => {
    const t = Number(tplSelect.value);
    const u = Math.max(1, Number(unitInput.value) || 1);
    const dur = Math.max(10, Math.min(300, Number(durInput.value) || 60));
    const contentSeed = Number(contentInput.value) || 1;
    const unitSeed = 1000 + t * 10000 + (u - 1) * 137;
    const params = instantiateUnit(DEVICE_TEMPLATES[t], unitSeed);
    const { signal, sampleRate } = synthesize(params, dur, contentSeed);
    setAudio({ samples: signal, sampleRate, durationSec: dur, fileName: `合成检材_${DEVICE_TEMPLATES[t].modelName}_#${u}.wav` });
    showToast(`已合成 ${dur}s 检材（内容种子 ${contentSeed}，与建库录音内容独立）`);
  });
  synthBox.append(
    el('summary', {}, '没有检材文件？用设备模板合成一段（测试流程）'),
    el('div', { className: 'row', style: 'margin-top:12px' },
      el('div', { className: 'field' }, el('label', {}, '型号模板'), tplSelect),
      el('div', { className: 'field' }, el('label', {}, '个体编号'), unitInput),
      el('div', { className: 'field' }, el('label', {}, '时长(秒)'), durInput),
      el('div', { className: 'field' }, el('label', {}, '内容种子'), contentInput),
      btnGen,
    ),
  );

  srcPanel.append(dz, fileInput, el('div', { style: 'height:12px' }), synthBox);
  container.append(srcPanel);

  // —— 比对 ——
  const runPanel = el('div', { className: 'panel' });
  runPanel.append(el('h2', {}, '2. 执行比对'));

  let current: LoadedAudio | null = null;
  let queryFp: DeviceFingerprint | null = null;
  let lastResults: MatchResult[] | null = null;

  const info = el('div', { className: 'muted' }, '尚未载入检材');
  const btnPlay = el('button', { className: 'btn secondary small', disabled: '' }, '试听检材');
  btnPlay.addEventListener('click', () => current && playAudio(current));
  const btnRun = el('button', { className: 'btn', disabled: '' }, `提取特征并与 ${store.devices.length} 台设备比对`);
  const btnSaveCase = el('button', { className: 'btn secondary', disabled: '' }, '保存为鉴定案件');
  const timing = el('div', { className: 'muted', style: 'margin-top:8px' }, '');
  const resultWrap = el('div', {});

  async function handleFile(f: File): Promise<void> {
    try {
      const audio = await loadAudioFile(f, f.name);
      setAudio(audio);
    } catch (err) {
      showToast(`检材解码失败：${(err as Error).message}`, true);
    }
  }

  function setAudio(a: LoadedAudio): void {
    current = a;
    queryFp = null;
    lastResults = null;
    btnRun.disabled = false;
    btnSaveCase.disabled = true;
    btnPlay.disabled = false;
    info.textContent = `检材：${a.fileName}，${fmtDuration(a.durationSec)}，${a.sampleRate}Hz`;
    clear(resultWrap);
    timing.textContent = '';
  }

  btnRun.addEventListener('click', () => {
    if (!current) return;
    try {
      const t0 = performance.now();
      queryFp = extractFingerprint(current.samples, current.sampleRate);
      const t1 = performance.now();
      lastResults = compareBatch(queryFp, store.devices);
      const t2 = performance.now();
      timing.textContent = `特征提取 ${(t1 - t0).toFixed(0)}ms · ${store.devices.length} 台指纹比对 ${(t2 - t1).toFixed(0)}ms · 合计 ${(t2 - t0).toFixed(0)}ms`;
      btnSaveCase.disabled = false;
      renderResults(resultWrap, queryFp, lastResults);
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });

  btnSaveCase.addEventListener('click', () => {
    if (!lastResults || !current) return;
    if (!caseNameInput.value.trim()) {
      showToast('请填写案件名称', true);
      return;
    }
    const conclusion = conclude(lastResults);
    const rec: Omit<CaseRecord, 'id' | 'createdAt'> = {
      caseName: caseNameInput.value.trim(),
      evidenceFileName: current.fileName,
      evidenceDurationSec: current.durationSec,
      evidenceSampleRate: current.sampleRate,
      results: lastResults,
      conclusion,
    };
    const saved = store.addCase(rec);
    showToast('案件已保存，可在「鉴定报告页」查看报告');
    onGoReport(saved.id);
  });

  runPanel.append(
    el('div', { className: 'row' }, info, btnPlay),
    el('div', { className: 'row', style: 'margin-top:12px' }, btnRun, btnSaveCase),
    timing, resultWrap,
  );
  container.append(runPanel);
}

function scoreBadge(score: number): HTMLElement {
  const cls = score >= 80 ? 'good' : score >= 55 ? 'warn' : 'bad';
  return el('span', { className: `badge ${cls}` }, String(score));
}

function renderResults(wrap: HTMLElement, queryFp: DeviceFingerprint, results: MatchResult[]): void {
  clear(wrap);
  const conclusion = conclude(results);
  const levelCls = conclusion.level.includes('强烈') ? 'good' : conclusion.level.includes('倾向同一') ? 'info' : conclusion.level.includes('排除') ? 'bad' : 'warn';

  wrap.append(
    el('div', { className: 'panel', style: 'margin-top:16px' },
      el('h2', {}, '鉴定意见'),
      el('p', {}, el('span', { className: `badge ${levelCls}`, style: 'font-size:13px;padding:5px 14px' }, conclusion.level)),
      el('p', { className: 'muted', style: 'margin-top:8px' }, conclusion.advice),
    ),
  );

  const tablePanel = el('div', { className: 'panel' });
  tablePanel.append(el('h2', {}, `相似度排名（共 ${results.length} 台，前 15 名）`));
  const table = el('table', { className: 'comp-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, '排名'), el('th', {}, '设备'), el('th', {}, '型号'),
    el('th', {}, '相似度'), el('th', {}, '分数条'), el('th', {}, '频响'), el('th', {}, '噪声'), el('th', {}, 'AGC'), el('th', {}, '截止'), el('th', {}, ''),
  )));
  const tbody = el('tbody', {});
  for (const r of results.slice(0, 15)) {
    const tr = el('tr', {});
    const rankBadge = r.rank === 1 ? el('span', { className: 'badge good' }, `#${r.rank}`) : el('span', { className: 'badge info' }, `#${r.rank}`);
    tr.append(
      el('td', {}, rankBadge),
      el('td', {}, r.deviceName),
      el('td', { className: 'muted' }, r.model),
      el('td', { className: 'num' }, scoreBadge(r.score)),
      el('td', {}, el('div', { className: `score-bar${r.score < 55 ? ' low' : ''}` }, el('i', { style: `width:${r.score}%` }))),
      ...r.components.map((c) => el('td', { className: 'num muted' }, c.distance.toFixed(3))),
    );
    const tdBtn = el('td', {});
    const b = el('button', { className: 'btn secondary small' }, '特征对比');
    b.addEventListener('click', () => openCompare(queryFp, r.deviceId, r));
    tdBtn.append(b);
    tr.append(tdBtn);
    tbody.append(tr);
  }
  table.append(tbody);
  tablePanel.append(table);
  wrap.append(tablePanel);
}

function openCompare(queryFp: DeviceFingerprint, deviceId: string, r: MatchResult): void {
  const dev = store.devices.find((d) => d.id === deviceId);
  if (!dev) return;
  const overlay = el('div', {
    style: 'position:fixed;inset:0;background:rgba(15,22,40,0.55);z-index:50;overflow:auto;padding:30px 16px;',
  });
  const box = el('div', { style: 'max-width:980px;margin:0 auto;background:#fff;border-radius:12px;padding:24px 28px;' });
  const close = el('button', { className: 'btn secondary small' }, '关闭');
  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  box.append(
    el('div', { className: 'row', style: 'justify-content:space-between;align-items:center' },
      el('h2', { className: 'page-title' }, `特征对比：检材 vs ${r.deviceName}（相似度 ${r.score}）`), close),
    el('div', { className: 'panel' },
      el('h2', {}, '分量距离明细（越小越相似）'),
      el('table', { className: 'comp-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '特征'), el('th', {}, '权重'), el('th', {}, '归一化距离'), el('th', {}, '说明'))),
        el('tbody', {}, ...r.components.map((c) => el('tr', {},
          el('td', {}, c.name),
          el('td', { className: 'num' }, `${(c.weight * 100).toFixed(0)}%`),
          el('td', { className: 'num' }, c.distance.toFixed(4)),
          el('td', { className: 'muted' }, c.detail),
        ))),
      ),
    ),
    fingerprintPanels(queryFp, dev.fingerprint),
  );
  document.body.append(overlay);
}

/**
 * 设备库页：指纹列表、详情查看、导入导出、合成设备批量生成。
 */
import { store } from '../../state/store.ts';
import type { DeviceRecord } from '../../state/types.ts';
import { DEVICE_TEMPLATES, instantiateUnit, synthesize } from '../../dsp/synth.ts';
import { extractFingerprint } from '../../dsp/features.ts';
import { encodeWav } from '../../dsp/wav.ts';
import { el, clear, showToast, fmtDate, download } from '../dom.ts';
import { fingerprintPanels } from '../fingerprintView.ts';

export function renderLibrary(container: HTMLElement): void {
  clear(container);
  container.append(
    el('h2', { className: 'page-title' }, '设备指纹库'),
    el('p', { className: 'page-desc' }, '管理已知设备的参考指纹。每台设备由四类与说话内容无关的特征刻画：频响曲线、本底噪声谱、AGC 动作、编码器高频截止。'),
  );

  // —— 合成测试设备 ——
  const synthPanel = el('div', { className: 'panel' });
  synthPanel.append(el('h2', {}, '批量生成合成测试设备 ', el('span', { className: 'tag' }, '评测用')));
  const desc = el('p', { className: 'muted' },
    `内置 ${DEVICE_TEMPLATES.length} 个型号模板（${DEVICE_TEMPLATES.map((t) => t.modelName).join('、')}），同型号不同个体的参数按高斯抖动独立实例化。`);
  synthPanel.append(desc);

  const perModelInput = el('input', { type: 'number', value: '5', min: '1', max: '30' }) as HTMLInputElement;
  const secInput = el('input', { type: 'number', value: '30', min: '8', max: '120' }) as HTMLInputElement;
  const btnSynth = el('button', { className: 'btn' }, '生成并入库');
  const progress = el('div', { className: 'progress-line' }, el('i', {}));
  const progressWrap = el('div', { style: 'display:none' }, progress);

  btnSynth.addEventListener('click', async () => {
    const perModel = Math.max(1, Math.min(30, Number(perModelInput.value) || 5));
    const secs = Math.max(8, Math.min(120, Number(secInput.value) || 30));
    btnSynth.disabled = true;
    progressWrap.style.display = 'block';
    const bar = progress.firstElementChild as HTMLElement;
    try {
      let count = 0;
      const total = DEVICE_TEMPLATES.length * perModel;
      for (let t = 0; t < DEVICE_TEMPLATES.length; t++) {
        for (let u = 0; u < perModel; u++) {
          const unitSeed = 1000 + t * 10000 + u * 137;
          const params = instantiateUnit(DEVICE_TEMPLATES[t], unitSeed);
          const { signal, sampleRate } = synthesize(params, secs, 50000 + t * 101 + u * 7);
          const fp = extractFingerprint(signal, sampleRate);
          store.addDevice({
            id: `syn_${t}_${u}`,
            name: `${DEVICE_TEMPLATES[t].modelName} #${u + 1}`,
            model: DEVICE_TEMPLATES[t].modelName,
            fingerprint: fp,
            note: `合成设备（参考录音 ${secs}s）`,
            synthetic: { templateIndex: t, unitSeed, templateName: DEVICE_TEMPLATES[t].modelName },
          });
          count++;
          bar.style.width = `${(count / total) * 100}%`;
          if (count % 4 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      }
      showToast(`已生成 ${count} 台设备指纹并入库`);
    } catch (err) {
      showToast((err as Error).message, true);
    } finally {
      btnSynth.disabled = false;
      setTimeout(() => (progressWrap.style.display = 'none'), 800);
    }
  });

  synthPanel.append(
    el('div', { className: 'row' },
      el('div', { className: 'field' }, el('label', {}, '每型号个体数'), perModelInput),
      el('div', { className: 'field' }, el('label', {}, '参考录音时长(秒)'), secInput),
      btnSynth,
    ),
    progressWrap,
  );
  container.append(synthPanel);

  // —— 库管理 ——
  const listPanel = el('div', { className: 'panel' });
  const header = el('h2', {}, `库内设备（${store.devices.length} 台）`);
  listPanel.append(header);

  const btnExport = el('button', { className: 'btn secondary small' }, '导出 JSON');
  btnExport.addEventListener('click', () => {
    download('device-fingerprints.json', store.exportJson(), 'application/json');
  });
  const fileImport = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' }) as HTMLInputElement;
  const btnImport = el('button', { className: 'btn secondary small' }, '导入 JSON');
  btnImport.addEventListener('click', () => fileImport.click());
  fileImport.addEventListener('change', async () => {
    const f = fileImport.files?.[0];
    if (!f) return;
    try {
      const r = store.importJson(await f.text());
      showToast(`导入 ${r.devices} 台设备、${r.cases} 条案件`);
    } catch (err) {
      showToast(`导入失败：${(err as Error).message}`, true);
    }
    fileImport.value = '';
  });
  const btnClear = el('button', { className: 'btn ghost-danger small' }, '清空设备库');
  btnClear.addEventListener('click', () => {
    if (confirm(`确认清空全部 ${store.devices.length} 台设备？此操作不可恢复。`)) {
      store.clearDevices();
      showToast('设备库已清空');
    }
  });
  listPanel.append(el('div', { className: 'row', style: 'margin-bottom:12px' }, btnExport, btnImport, fileImport, btnClear));

  if (store.devices.length === 0) {
    listPanel.append(el('div', { className: 'empty' }, '设备库为空。可在上方生成合成测试设备，或到「建模页」用真实录音建立指纹。'));
  } else {
    const table = el('table', {});
    table.append(el('thead', {}, el('tr', {},
      el('th', {}, '设备名称'), el('th', {}, '型号'), el('th', {}, '来源'),
      el('th', {}, '采样率'), el('th', {}, '截止频率'), el('th', {}, '建库时间'), el('th', {}, '操作'),
    )));
    const tbody = el('tbody', {});
    for (const d of store.devices) {
      const tr = el('tr', {});
      tr.append(
        el('td', {}, d.name),
        el('td', {}, d.model),
        el('td', {}, d.synthetic ? el('span', { className: 'badge info' }, '合成') : el('span', { className: 'badge good' }, '真实录音')),
        el('td', {}, `${d.fingerprint.sampleRate}Hz`),
        el('td', {}, d.fingerprint.cutoffHz ? `${Math.round(d.fingerprint.cutoffHz)}Hz` : '—'),
        el('td', { className: 'muted' }, fmtDate(d.createdAt)),
      );
      const tdOp = el('td', {});
      const btnView = el('button', { className: 'btn secondary small' }, '查看指纹');
      btnView.addEventListener('click', () => openDetail(d));
      const btnWav = el('button', { className: 'btn secondary small' }, '导出WAV');
      if (!d.synthetic) btnWav.disabled = true;
      btnWav.addEventListener('click', () => exportSynthWav(d));
      const btnDel = el('button', { className: 'btn ghost-danger small' }, '删除');
      btnDel.addEventListener('click', () => {
        if (confirm(`删除设备「${d.name}」？`)) store.removeDevice(d.id);
      });
      tdOp.append(btnView, ' ', btnWav, ' ', btnDel);
      tr.append(tdOp);
      tbody.append(tr);
    }
    table.append(tbody);
    listPanel.append(table);
  }
  container.append(listPanel);
}

function openDetail(d: DeviceRecord): void {
  const overlay = el('div', {
    style: 'position:fixed;inset:0;background:rgba(15,22,40,0.55);z-index:50;overflow:auto;padding:30px 16px;',
  });
  const box = el('div', {
    style: 'max-width:980px;margin:0 auto;background:#fff;border-radius:12px;padding:24px 28px;',
  });
  box.append(
    el('div', { className: 'row', style: 'justify-content:space-between;align-items:center' },
      el('h2', { className: 'page-title' }, `设备指纹详情：${d.name}`),
      (() => {
        const b = el('button', { className: 'btn secondary small' }, '关闭');
        b.addEventListener('click', () => overlay.remove());
        return b;
      })(),
    ),
    el('p', { className: 'muted' }, `型号 ${d.model} · ${d.note ?? ''}`),
    fingerprintPanels(d.fingerprint),
  );
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.append(overlay);
}

function exportSynthWav(d: DeviceRecord): void {
  if (!d.synthetic) return;
  const tpl = DEVICE_TEMPLATES[d.synthetic.templateIndex];
  const params = instantiateUnit(tpl, d.synthetic.unitSeed);
  const { signal, sampleRate } = synthesize(params, 10, 88888);
  download(`${d.name}.wav`, encodeWav(signal, sampleRate), 'audio/wav');
  showToast('已导出 10 秒合成 WAV 样本');
}

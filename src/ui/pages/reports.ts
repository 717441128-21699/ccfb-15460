/**
 * 鉴定报告页：案件列表、报告详情、打印与导出。
 */
import { store } from '../../state/store.ts';
import type { CaseRecord } from '../../state/types.ts';
import { el, clear, showToast, fmtDate, fmtDuration, download } from '../dom.ts';

export function renderReports(container: HTMLElement, focusCaseId?: string): void {
  clear(container);
  container.append(
    el('h2', { className: 'page-title' }, '鉴定报告'),
    el('p', { className: 'page-desc' }, '已保存案件的检验报告，含检材信息、比对方法、相似度排名与鉴定意见，可打印或导出文本。'),
  );

  if (store.cases.length === 0) {
    container.append(el('div', { className: 'panel empty' }, '暂无案件。完成一次检材比对并保存后，报告会出现在这里。'));
    return;
  }

  const listPanel = el('div', { className: 'panel' });
  listPanel.append(el('h2', {}, `案件列表（${store.cases.length}）`));
  const table = el('table', {});
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, '案件名称'), el('th', {}, '检材文件'), el('th', {}, '时长'),
    el('th', {}, '鉴定意见'), el('th', {}, 'Top1 设备'), el('th', {}, '时间'), el('th', {}, '操作'),
  )));
  const tbody = el('tbody', {});
  for (const c of store.cases) {
    const top = c.results[0];
    const levelCls = c.conclusion.level.includes('强烈') ? 'good' : c.conclusion.level.includes('倾向同一') ? 'info' : c.conclusion.level.includes('排除') ? 'bad' : 'warn';
    const tr = el('tr', {});
    tr.append(
      el('td', {}, c.caseName),
      el('td', { className: 'muted' }, c.evidenceFileName),
      el('td', {}, fmtDuration(c.evidenceDurationSec)),
      el('td', {}, el('span', { className: `badge ${levelCls}` }, c.conclusion.level)),
      el('td', {}, top ? `${top.deviceName}（${top.score}）` : '—'),
      el('td', { className: 'muted' }, fmtDate(c.createdAt)),
    );
    const td = el('td', {});
    const bView = el('button', { className: 'btn secondary small' }, '查看报告');
    bView.addEventListener('click', () => openReport(c));
    const bDel = el('button', { className: 'btn ghost-danger small' }, '删除');
    bDel.addEventListener('click', () => {
      if (confirm(`删除案件「${c.caseName}」？`)) store.removeCase(c.id);
    });
    td.append(bView, ' ', bDel);
    tr.append(td);
    tbody.append(tr);
  }
  table.append(tbody);
  listPanel.append(table);
  container.append(listPanel);

  if (focusCaseId) {
    const c = store.cases.find((x) => x.id === focusCaseId);
    if (c) openReport(c);
  }
}

function openReport(c: CaseRecord): void {
  const overlay = el('div', {
    style: 'position:fixed;inset:0;background:rgba(15,22,40,0.55);z-index:50;overflow:auto;padding:30px 16px;',
  });
  const box = el('div', { style: 'max-width:940px;margin:0 auto;' });
  const report = buildReport(c);
  const bar = el('div', { className: 'row', style: 'justify-content:flex-end;margin-bottom:10px;position:sticky;top:0' });
  const bPrint = el('button', { className: 'btn small' }, '打印 / 另存 PDF');
  bPrint.addEventListener('click', () => window.print());
  const bTxt = el('button', { className: 'btn secondary small' }, '导出文本报告');
  bTxt.addEventListener('click', () => {
    download(`${c.caseName}_鉴定报告.txt`, reportToText(c), 'text/plain;charset=utf-8');
    showToast('文本报告已导出');
  });
  const bClose = el('button', { className: 'btn secondary small' }, '关闭');
  bClose.addEventListener('click', () => overlay.remove());
  bar.append(bPrint, bTxt, bClose);
  box.append(bar, report);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

function buildReport(c: CaseRecord): HTMLElement {
  const top = c.results[0];
  const levelCls = c.conclusion.level.includes('强烈') ? 'good' : c.conclusion.level.includes('倾向同一') ? 'info' : c.conclusion.level.includes('排除') ? 'bad' : 'warn';
  const box = el('div', { className: 'report-box' });

  box.append(
    el('h2', { style: 'text-align:center;font-size:20px;margin:0 0 4px;border:0' }, '录音设备同一性检验报告'),
    el('p', { style: 'text-align:center' , className: 'muted' }, `报告编号：${c.id}　　生成时间：${fmtDate(c.createdAt)}`),
    el('h3', {}, '一、检材概况'),
    el('div', { className: 'kv' },
      el('div', { className: 'k' }, '案件名称'), el('div', {}, c.caseName),
      el('div', { className: 'k' }, '检材文件名'), el('div', {}, c.evidenceFileName),
      el('div', { className: 'k' }, '检材时长'), el('div', {}, fmtDuration(c.evidenceDurationSec)),
      el('div', { className: 'k' }, '采样率'), el('div', {}, `${c.evidenceSampleRate} Hz`),
      el('div', { className: 'k' }, '比对设备数'), el('div', {}, `${c.results.length} 台`),
    ),
    el('h3', {}, '二、检验方法'),
    el('p', { className: 'muted' },
      '采用 Web Audio API 解码检材，对 PCM 信号以 2048 点 Hann 窗、50% 重叠分帧做 STFT，提取四类设备链路特征：'
      + '（1）对数频带频响曲线形状；（2）逐频带低分位本底噪声谱；（3）帧电平百分位与包络时间常数刻画的 AGC 动作特点；'
      + '（4）高频能量边缘检测得到的编码器截止频率。上述特征均不依赖语音的文本内容。'
      + '检材指纹与设备库指纹按频响 34%、噪声 30%、AGC 21%、截止 15% 的权重计算归一化加权距离，并映射为 0~100 相似度。'),
    el('h3', {}, '三、检验结果'),
    el('p', {}, '相似度排名前 10 的设备如下：'),
  );

  const table = el('table', { className: 'comp-table' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, '排名'), el('th', {}, '设备名称'), el('th', {}, '型号'),
    el('th', {}, '相似度'), el('th', {}, '频响距离'), el('th', {}, '噪声距离'), el('th', {}, 'AGC距离'), el('th', {}, '截止距离'),
  )));
  const tbody = el('tbody', {});
  for (const r of c.results.slice(0, 10)) {
    tbody.append(el('tr', {},
      el('td', {}, String(r.rank)),
      el('td', {}, r.deviceName),
      el('td', {}, r.model),
      el('td', { className: 'num' }, String(r.score)),
      ...r.components.map((cmp) => el('td', { className: 'num muted' }, cmp.distance.toFixed(4))),
    ));
  }
  table.append(tbody);
  box.append(table);

  box.append(
    el('h3', {}, '四、鉴定意见'),
    el('p', {}, el('span', { className: `badge ${levelCls}`, style: 'font-size:14px;padding:6px 16px' }, c.conclusion.level)),
    el('p', { className: 'muted', style: 'margin-top:8px' }, c.conclusion.advice),
    el('h3', {}, '五、Top1 设备分量明细'),
    top
      ? el('table', { className: 'comp-table' },
          el('thead', {}, el('tr', {}, el('th', {}, '特征'), el('th', {}, '权重'), el('th', {}, '归一化距离'), el('th', {}, '说明'))),
          el('tbody', {}, ...top.components.map((cmp) => el('tr', {},
            el('td', {}, cmp.name),
            el('td', { className: 'num' }, `${(cmp.weight * 100).toFixed(0)}%`),
            el('td', { className: 'num' }, cmp.distance.toFixed(4)),
            el('td', { className: 'muted' }, cmp.detail),
          ))),
        )
      : el('p', { className: 'muted' }, '无比对结果。'),
    el('p', { className: 'muted', style: 'margin-top:26px;font-size:12px' },
      '说明：本报告由自动化特征比对系统生成，相似度为统计意义上的支持强度，最终鉴定意见须结合案件情况由具备资质的鉴定人复核。'),
  );
  return box;
}

function reportToText(c: CaseRecord): string {
  const lines: string[] = [];
  lines.push('录音设备同一性检验报告');
  lines.push('='.repeat(40));
  lines.push(`报告编号：${c.id}`);
  lines.push(`生成时间：${fmtDate(c.createdAt)}`);
  lines.push(`案件名称：${c.caseName}`);
  lines.push(`检材文件：${c.evidenceFileName}`);
  lines.push(`检材时长：${fmtDuration(c.evidenceDurationSec)}　采样率：${c.evidenceSampleRate}Hz`);
  lines.push(`比对设备数：${c.results.length}`);
  lines.push('');
  lines.push('一、相似度排名（前 10）');
  lines.push('-'.repeat(40));
  lines.push('排名  相似度  设备名称 / 型号');
  for (const r of c.results.slice(0, 10)) {
    lines.push(`#${String(r.rank).padEnd(3)} ${String(r.score).padEnd(5)}  ${r.deviceName} / ${r.model}`);
  }
  lines.push('');
  lines.push(`二、鉴定意见：${c.conclusion.level}`);
  lines.push(c.conclusion.advice);
  if (c.results[0]) {
    lines.push('');
    lines.push('三、Top1 分量距离');
    for (const cmp of c.results[0].components) {
      lines.push(`- ${cmp.name}（权重 ${(cmp.weight * 100).toFixed(0)}%）：d=${cmp.distance.toFixed(4)}；${cmp.detail}`);
    }
  }
  lines.push('');
  lines.push('本报告由自动化特征比对系统生成，须由具备资质的鉴定人复核。');
  return lines.join('\n');
}

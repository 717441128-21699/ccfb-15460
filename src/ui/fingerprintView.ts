/**
 * 指纹特征详情：频响曲线、噪声谱、AGC 百分位、截止频率。
 */
import type { DeviceFingerprint } from '../dsp/features.ts';
import { drawBarChart, drawLineChart } from './charts.ts';
import { el } from './dom.ts';

export function fingerprintPanels(fp: DeviceFingerprint, compareWith?: DeviceFingerprint): HTMLElement {
  const wrap = el('div', {});

  // —— 关键指标 ——
  const metric = (k: string, v: string) =>
    el('div', { className: 'metric' }, el('div', { className: 'k' }, k), el('div', { className: 'v' }, v));
  const metrics = el('div', { className: 'metric-grid' },
    metric('采样率', `${fp.sampleRate} Hz`),
    metric('分析帧数', String(fp.frameCount)),
    metric('参考电平', `${fp.referenceLevel.toFixed(1)} dBFS`),
    metric('高频截止', fp.cutoffHz ? `${Math.round(fp.cutoffHz)} Hz` : '未检出'),
    metric('AGC 启动 τ', `${fp.agc.attackTau.toFixed(1)} 帧`),
    metric('AGC 恢复 τ', `${fp.agc.releaseTau.toFixed(1)} 帧`),
  );
  wrap.append(metrics);

  // —— 频响曲线 ——
  const p1 = el('div', { className: 'panel' }, el('h2', {}, '频响曲线（对数频带相对形状，dB）'));
  const c1 = el('canvas', { className: 'chart' });
  p1.append(c1);
  wrap.append(p1);

  // —— 本底噪声谱 ——
  const p2 = el('div', { className: 'panel' }, el('h2', {}, '本底噪声谱（相对参考电平分贝值）'));
  const c2 = el('canvas', { className: 'chart' });
  p2.append(c2);
  wrap.append(p2);

  // —— AGC 电平分布 ——
  const p3 = el('div', { className: 'panel' }, el('h2', {}, '帧电平百分位分布（AGC / 动态特征）'));
  const c3 = el('canvas', { className: 'chart' });
  p3.append(c3);
  wrap.append(p3);

  requestAnimationFrame(() => {
    drawLineChart(c1, {
      xLog: true,
      xLabel: '频率 (Hz)',
      yLabel: 'dB',
      series: [
        { label: '本指纹', color: '#2456d6', x: fp.bandCenters, y: fp.frequencyResponse },
        ...(compareWith
          ? [{ label: '对比指纹', color: '#d97706', x: compareWith.bandCenters, y: compareWith.frequencyResponse, dashed: true }]
          : []),
      ],
    });
    drawLineChart(c2, {
      xLog: true,
      xLabel: '频率 (Hz)',
      yLabel: 'dB',
      series: [
        { label: '噪声电平', color: '#15803d', x: fp.bandCenters, y: fp.noiseFloor },
        ...(compareWith
          ? [{ label: '对比噪声', color: '#d97706', x: compareWith.bandCenters, y: compareWith.noiseFloor, dashed: true }]
          : []),
      ],
    });
    const pctLabels = ['P10', 'P25', 'P50', 'P75', 'P90'];
    drawBarChart(c3, {
      labels: pctLabels,
      series: [
        { label: '本指纹', color: '#2456d6', values: fp.agc.levelPercentiles },
        ...(compareWith
          ? [{ label: '对比指纹', color: '#d97706', values: compareWith.agc.levelPercentiles }]
          : []),
      ],
    });
  });

  return wrap;
}

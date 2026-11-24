/**
 * 轻量 Canvas 绘图工具：频响曲线、噪声谱、AGC 电平分布。
 * 全部用原生 Canvas 2D，无第三方图表库。
 */
export interface CurveSeries {
  label: string;
  color: string;
  x: number[];
  y: number[];
  dashed?: boolean;
}

export function drawLineChart(
  canvas: HTMLCanvasElement,
  opts: {
    series: CurveSeries[];
    xLog?: boolean;
    xLabel?: string;
    yLabel?: string;
    yMin?: number;
    yMax?: number;
    gridCount?: number;
  },
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 260;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 58;
  const padR = 16;
  const padT = 18;
  const padB = 40;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  const allX = opts.series.flatMap((s) => s.x);
  const allY = opts.series.flatMap((s) => s.y);
  const xMin0 = Math.min(...allX);
  const xMax0 = Math.max(...allX);
  const yMin = opts.yMin ?? Math.floor(Math.min(...allY));
  const yMax = opts.yMax ?? Math.ceil(Math.max(...allY));

  const xMap = (x: number) => {
    const t = opts.xLog
      ? (Math.log(x) - Math.log(xMin0)) / (Math.log(xMax0) - Math.log(xMin0))
      : (x - xMin0) / (xMax0 - xMin0);
    return padL + t * plotW;
  };
  const yMap = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  // 网格与 Y 轴刻度
  ctx.strokeStyle = 'rgba(128,140,160,0.25)';
  ctx.fillStyle = 'rgba(120,130,150,1)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const gridCount = opts.gridCount ?? 5;
  for (let i = 0; i <= gridCount; i++) {
    const yv = yMin + ((yMax - yMin) * i) / gridCount;
    const py = yMap(yv);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(padL + plotW, py);
    ctx.stroke();
    ctx.fillText(yv.toFixed(0), padL - 6, py);
  }

  // X 轴刻度（对数轴按十倍频/标注）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const ticks = opts.xLog ? logTicks(xMin0, xMax0) : linTicks(xMin0, xMax0, 6);
  for (const tv of ticks) {
    const px = xMap(tv);
    ctx.strokeStyle = 'rgba(128,140,160,0.18)';
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,130,150,1)';
    ctx.fillText(formatHz(tv), px, padT + plotH + 6);
  }

  // 坐标轴标题
  if (opts.xLabel) {
    ctx.fillStyle = 'rgba(100,110,130,1)';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel, padL + plotW / 2, cssH - 6);
  }
  if (opts.yLabel) {
    ctx.save();
    ctx.translate(14, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(100,110,130,1)';
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();
  }

  // 曲线
  for (const s of opts.series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    for (let i = 0; i < s.x.length; i++) {
      const px = xMap(s.x[i]);
      const py = yMap(s.y[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 图例
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let lx = padL + 8;
  for (const s of opts.series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, padT + 6, 16, 3);
    ctx.fillStyle = 'rgba(80,90,110,1)';
    ctx.fillText(s.label, lx + 22, padT + 7);
    lx += 28 + ctx.measureText(s.label).width + 18;
  }
}

function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  let decade = Math.pow(10, Math.floor(Math.log10(min)));
  while (decade <= max) {
    for (const m of [1, 2, 5]) {
      const v = decade * m;
      if (v >= min && v <= max) out.push(v);
    }
    decade *= 10;
  }
  return out;
}

function linTicks(min: number, max: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(min + ((max - min) * i) / count);
  return out;
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`;
}

/** 柱状图（用于 AGC 电平百分位对比） */
export function drawBarChart(
  canvas: HTMLCanvasElement,
  opts: { labels: string[]; series: Array<{ label: string; color: string; values: number[] }> },
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 240;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 58;
  const padR = 16;
  const padT = 18;
  const padB = 40;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  const allV = opts.series.flatMap((s) => s.values);
  const yMin = Math.floor(Math.min(...allV) / 5) * 5;
  const yMax = Math.ceil(Math.max(...allV) / 5) * 5;
  const yMap = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  ctx.strokeStyle = 'rgba(128,140,160,0.25)';
  ctx.fillStyle = 'rgba(120,130,150,1)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const yv = yMin + ((yMax - yMin) * i) / 5;
    const py = yMap(yv);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(padL + plotW, py);
    ctx.stroke();
    ctx.fillText(yv.toFixed(0), padL - 6, py);
  }

  const groupW = plotW / opts.labels.length;
  const barW = (groupW * 0.6) / opts.series.length;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let g = 0; g < opts.labels.length; g++) {
    const gx = padL + g * groupW + groupW * 0.2;
    for (let s = 0; s < opts.series.length; s++) {
      const v = opts.series[s].values[g];
      const px = gx + s * barW;
      const py = yMap(v);
      ctx.fillStyle = opts.series[s].color;
      ctx.fillRect(px, py, barW - 2, padT + plotH - py);
    }
    ctx.fillStyle = 'rgba(100,110,130,1)';
    ctx.fillText(opts.labels[g], padL + g * groupW + groupW / 2, padT + plotH + 6);
  }

  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let lx = padL + 8;
  for (const s of opts.series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, padT + 6, 16, 10);
    ctx.fillStyle = 'rgba(80,90,110,1)';
    ctx.fillText(s.label, lx + 22, padT + 11);
    lx += 28 + ctx.measureText(s.label).width + 18;
  }
}

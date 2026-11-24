/**
 * 基 2 迭代 FFT（原地运算）。
 * 针对 2048/4096 点这类反复使用的尺寸缓存旋转因子表。
 */
const tableCache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function buildTables(n: number) {
  const cached = tableCache.get(n);
  if (cached) return cached;

  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    const theta = (-2 * Math.PI * i) / n;
    cos[i] = Math.cos(theta);
    sin[i] = Math.sin(theta);
  }

  const rev = new Uint32Array(n);
  let bits = 0;
  for (let i = n; i > 1; i >>= 1) bits++;
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = r;
  }

  const tables = { cos, sin, rev };
  tableCache.set(n, tables);
  return tables;
}

/** 原地基 2 FFT，n 必须为 2 的幂 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = buildTables(n);

  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      let k = 0;
      for (let j = 0; j < half; j++, k += step) {
        const a = start + j;
        const b = a + half;
        const wr = cos[k];
        const wi = sin[k];
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** 实数序列的单边功率谱 |X(k)|^2，长度 n/2+1 */
export function powerSpectrum(frame: Float64Array): Float64Array {
  const n = frame.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(frame);
  fft(re, im);
  const out = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) {
    out[k] = re[k] * re[k] + im[k] * im[k];
  }
  return out;
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

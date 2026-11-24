/**
 * 窗函数。STFT 统一使用 Hann 窗。
 */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

const cache = new Map<number, Float64Array>();

export function hann(n: number): Float64Array {
  let w = cache.get(n);
  if (!w) {
    w = hannWindow(n);
    cache.set(n, w);
  }
  return w;
}

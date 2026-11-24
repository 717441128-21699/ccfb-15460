/**
 * 16bit PCM WAV 编码/解码（仅单声道与立体声，小端）。
 */
export function encodeWav(samples: Float64Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function decodeWav(buffer: ArrayBuffer): { samples: Float64Array; sampleRate: number } {
  const view = new DataView(buffer);
  const readStr = (offset: number, len: number) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  };
  if (readStr(0, 4) !== 'RIFF' || readStr(8, 4) !== 'WAVE') {
    throw new Error('不是合法的 WAV 文件');
  }
  let offset = 12;
  let audioFormat = 1;
  let channels = 1;
  let sampleRate = 0;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.byteLength) {
    const id = readStr(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      audioFormat = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = size;
      break;
    }
    offset = body + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error('WAV 中未找到 data 块');
  if (audioFormat !== 1) throw new Error('仅支持 PCM 格式 WAV');

  const frameBytes = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (frameBytes * channels));
  const samples = new Float64Array(frames);

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const p = dataOffset + (i * channels + ch) * frameBytes;
      let v: number;
      if (bitsPerSample === 16) v = view.getInt16(p, true) / 0x8000;
      else if (bitsPerSample === 8) v = (view.getUint8(p) - 128) / 128;
      else if (bitsPerSample === 24) {
        const b0 = view.getUint8(p);
        const b1 = view.getUint8(p + 1);
        const b2 = view.getUint8(p + 2);
        const int = b0 | (b1 << 8) | ((b2 << 24) >> 8);
        v = int / 0x800000;
      } else throw new Error(`不支持的位深 ${bitsPerSample}`);
      sum += v;
    }
    samples[i] = sum / channels;
  }
  return { samples, sampleRate };
}

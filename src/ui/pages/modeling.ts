/**
 * 建模页：通过麦克风录音或导入参考音频提取设备指纹并入库。
 */
import { store } from '../../state/store.ts';
import { extractFingerprint, type DeviceFingerprint } from '../../dsp/features.ts';
import { loadAudioFile, playAudio, Recorder, type LoadedAudio } from '../../audio/audioService.ts';
import { el, clear, showToast, fmtDuration } from '../dom.ts';
import { fingerprintPanels } from '../fingerprintView.ts';

export function renderModeling(container: HTMLElement): void {
  clear(container);
  container.append(
    el('h2', { className: 'page-title' }, '设备指纹建模'),
    el('p', { className: 'page-desc' },
      '用已知手机录制一段参考音（建议 20 秒以上，包含说话与停顿）。系统提取四类设备特征，说话内容不参与指纹构成。'),
  );

  // —— 音频获取 ——
  const inputPanel = el('div', { className: 'panel' });
  inputPanel.append(el('h2', {}, '1. 获取参考录音'));

  const nameInput = el('input', { type: 'text' }) as HTMLInputElement;
  nameInput.placeholder = '如：嫌疑人张三的手机';
  const modelInput = el('input', { type: 'text' }) as HTMLInputElement;
  modelInput.placeholder = '如：Aurora X1';
  const noteInput = el('input', { type: 'text' }) as HTMLInputElement;
  noteInput.placeholder = '备注（可选）';

  inputPanel.append(el('div', { className: 'row' },
    el('div', { className: 'field' }, el('label', {}, '设备名称 *'), nameInput),
    el('div', { className: 'field' }, el('label', {}, '型号 *'), modelInput),
    el('div', { className: 'field', style: 'flex:1;min-width:220px' }, el('label', {}, '备注'), noteInput),
  ));

  // 录音控件
  const recorder = new Recorder();
  let recording = false;
  const recBtn = el('button', { className: 'btn' }, el('span', { className: 'rec-dot' }), '开始麦克风录音');
  const recStatus = el('span', { className: 'muted' }, '');
  let timer: number | undefined;
  let startAt = 0;

  recBtn.addEventListener('click', async () => {
    try {
      if (!recording) {
        await recorder.start();
        recording = true;
        startAt = Date.now();
        recBtn.querySelector('.rec-dot')!.classList.add('on');
        recBtn.lastChild!.textContent = '停止录音';
        timer = window.setInterval(() => {
          recStatus.textContent = `录音中 ${((Date.now() - startAt) / 1000).toFixed(1)}s（已关闭浏览器降噪/AGC，保留原始链路特征）`;
        }, 200);
      } else {
        const audio = await recorder.stop();
        recording = false;
        window.clearInterval(timer);
        recBtn.querySelector('.rec-dot')!.classList.remove('on');
        recBtn.lastChild!.textContent = '开始麦克风录音';
        recStatus.textContent = `已录制 ${fmtDuration(audio.durationSec)}，${audio.sampleRate}Hz`;
        setAudio(audio);
      }
    } catch (err) {
      recording = false;
      showToast(`录音失败：${(err as Error).message}`, true);
    }
  });

  // 文件拖放
  const dz = el('div', { className: 'dropzone' },
    el('div', { className: 'big' }, '点击或拖入参考音频文件'),
    el('div', {}, '支持 WAV / MP3 / M4A / OGG，WAV 走自有 PCM 解析，其余由 Web Audio 解码'),
  );
  const fileInput = el('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a,.ogg', style: 'display:none' }) as HTMLInputElement;
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag');
  });
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

  async function handleFile(f: File): Promise<void> {
    try {
      const audio = await loadAudioFile(f, f.name);
      recStatus.textContent = `已载入 ${f.name}：${fmtDuration(audio.durationSec)}，${audio.sampleRate}Hz`;
      setAudio(audio);
    } catch (err) {
      showToast(`音频解码失败：${(err as Error).message}`, true);
    }
  }

  inputPanel.append(
    el('div', { className: 'row', style: 'margin:14px 0' }, recBtn, recStatus),
    dz, fileInput,
  );
  container.append(inputPanel);

  // —— 特征提取 ——
  const extractPanel = el('div', { className: 'panel' });
  extractPanel.append(el('h2', {}, '2. 提取指纹并入库'));

  let current: LoadedAudio | null = null;
  let fp: DeviceFingerprint | null = null;
  const audioInfo = el('div', { className: 'muted' }, '尚未载入音频');
  const btnPlay = el('button', { className: 'btn secondary small', disabled: '' }, '试听');
  btnPlay.addEventListener('click', () => current && playAudio(current));
  const btnExtract = el('button', { className: 'btn', disabled: '' }, '提取设备指纹');
  const btnSave = el('button', { className: 'btn', disabled: '' }, '保存到设备库');
  const resultWrap = el('div', {});

  function setAudio(a: LoadedAudio): void {
    current = a;
    fp = null;
    btnExtract.disabled = false;
    btnSave.disabled = true;
    btnPlay.disabled = false;
    audioInfo.textContent = `当前音频：${a.fileName}，${fmtDuration(a.durationSec)}，${a.sampleRate}Hz，${a.samples.length} 采样点`;
    clear(resultWrap);
  }

  btnExtract.addEventListener('click', () => {
    if (!current) return;
    try {
      fp = extractFingerprint(current.samples, current.sampleRate);
      btnSave.disabled = false;
      clear(resultWrap);
      resultWrap.append(
        el('p', { className: 'muted' },
          `提取完成：${fp.frameCount} 分析帧，参考电平 ${fp.referenceLevel.toFixed(1)}dBFS，高频截止 ${fp.cutoffHz ? Math.round(fp.cutoffHz) + 'Hz' : '未检出'}`),
        fingerprintPanels(fp),
      );
      showToast('指纹提取成功');
    } catch (err) {
      showToast((err as Error).message, true);
    }
  });

  btnSave.addEventListener('click', () => {
    if (!fp) return;
    if (!nameInput.value.trim() || !modelInput.value.trim()) {
      showToast('请填写设备名称与型号', true);
      return;
    }
    store.addDevice({
      name: nameInput.value.trim(),
      model: modelInput.value.trim(),
      note: noteInput.value.trim() || undefined,
      fingerprint: fp,
    });
    showToast(`设备「${nameInput.value.trim()}」已入库`);
    nameInput.value = '';
    modelInput.value = '';
    noteInput.value = '';
  });

  extractPanel.append(
    el('div', { className: 'row', style: 'margin-bottom:12px' }, audioInfo, btnPlay),
    el('div', { className: 'row' }, btnExtract, btnSave),
    resultWrap,
  );
  container.append(extractPanel);
}

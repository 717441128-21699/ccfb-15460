/**
 * 应用主入口：五个页签的路由与全局状态订阅。
 */
import './styles.css';
import { store } from '../state/store.ts';
import { el, clear } from './dom.ts';
import { renderLibrary } from './pages/library.ts';
import { renderModeling } from './pages/modeling.ts';
import { renderCompare } from './pages/compare.ts';
import { renderReports } from './pages/reports.ts';
import { renderEvaluation } from './pages/evaluation.ts';

type PageId = 'library' | 'modeling' | 'compare' | 'reports' | 'evaluation';

const TABS: Array<{ id: PageId; label: string }> = [
  { id: 'library', label: '设备库' },
  { id: 'modeling', label: '建模' },
  { id: 'compare', label: '检材比对' },
  { id: 'reports', label: '鉴定报告' },
  { id: 'evaluation', label: '指标评测' },
];

const main = el('main', {});
let currentPage: PageId = 'library';
let reportFocus: string | undefined;

function navigate(page: PageId): void {
  currentPage = page;
  reportFocus = undefined;
  render();
}

function render(): void {
  clear(main);
  switch (currentPage) {
    case 'library':
      renderLibrary(main);
      break;
    case 'modeling':
      renderModeling(main);
      break;
    case 'compare':
      renderCompare(main, (caseId) => {
        reportFocus = caseId;
        currentPage = 'reports';
        render();
      });
      break;
    case 'reports':
      renderReports(main, reportFocus);
      break;
    case 'evaluation':
      renderEvaluation(main);
      break;
  }
}

function boot(): void {
  const header = el('header', { className: 'app-header' });
  header.append(
    el('div', {},
      el('h1', {}, '录音设备指纹鉴定系统'),
      el('div', { className: 'sub' }, '频响 · 本底噪声 · AGC · 编码器截止 —— 与说话内容无关的设备链路特征'),
    ),
  );
  const nav = el('nav', { className: 'tabs' });
  for (const t of TABS) {
    const btn = el('button', { type: 'button' }, t.label);
    if (t.id === currentPage) btn.classList.add('active');
    btn.addEventListener('click', () => navigate(t.id));
    nav.append(btn);
  }
  header.append(nav);
  document.body.append(header, main);

  // 数据变化时重绘当前页（报告弹窗等浮层不受影响）
  store.subscribe(() => {
    nav.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', TABS[i].id === currentPage));
    render();
  });

  render();
}

boot();

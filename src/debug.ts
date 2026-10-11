// src/debug.ts
//
// デバッグ基盤。ウィンドウが複数（main + サブモニター）あっても、問題がすぐ見えるようにする。
//
//  1. ログ転送   : dlog / dwarn / derr を Rust 側のターミナルに集約する（ウィンドウのラベル付き）
//  2. エラー捕捉 : 未捕捉エラー・未処理の Promise 拒否・console.warn / console.error を自動で転送する
//  3. オーバーレイ: F2 か、トレイの「デバッグ表示」で、各ウィンドウに
//                   ラベル・モニター情報・解像度・FPS を重ねて表示する（モニター識別の確認用）

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { fetchCurrentMonitor, type MonitorInfo } from './monitor';

type Level = 'info' | 'warn' | 'error';

const WINDOW_LABEL = getCurrentWindow().label;

// フック前の console を保持（転送処理自身が再び転送を呼ばないため）
const orig = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** Rust のターミナルに 1 件送る。失敗してもアプリは止めない。 */
function forward(level: Level, message: string) {
  invoke('debug_log', { label: WINDOW_LABEL, level, message }).catch(() => {
    /* ログ転送の失敗でアプリを止めない */
  });
}

// 同じメッセージが大量に出ても（毎フレームの警告など）ターミナルが埋まらないようにする
const MAX_REPEAT = 5;
const seen = new Map<string, number>();
function allowForward(key: string): boolean {
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  if (n === MAX_REPEAT + 1) {
    forward('warn', `同じメッセージが ${MAX_REPEAT} 回を超えたので、以降は転送しない: ${key.slice(0, 120)}`);
  }
  return n <= MAX_REPEAT;
}

export function dlog(...args: unknown[]) {
  orig.log(`[${WINDOW_LABEL}]`, ...args);
  forward('info', args.map(stringify).join(' '));
}

export function dwarn(...args: unknown[]) {
  orig.warn(`[${WINDOW_LABEL}]`, ...args);
  forward('warn', args.map(stringify).join(' '));
}

export function derr(...args: unknown[]) {
  orig.error(`[${WINDOW_LABEL}]`, ...args);
  forward('error', args.map(stringify).join(' '));
}

// ---- 自動捕捉 --------------------------------------------------------------

function hookConsole() {
  console.warn = (...args: unknown[]) => {
    orig.warn(...args);
    const m = args.map(stringify).join(' ');
    if (allowForward(`warn:${m}`)) forward('warn', m);
  };
  console.error = (...args: unknown[]) => {
    orig.error(...args);
    const m = args.map(stringify).join(' ');
    if (allowForward(`error:${m}`)) forward('error', m);
  };
}

function installErrorHandlers() {
  window.addEventListener('error', (e) => {
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
    const stack = e.error instanceof Error && e.error.stack ? `\n${e.error.stack}` : '';
    const m = `未捕捉のエラー: ${e.message}${where}${stack}`;
    orig.error(m);
    if (allowForward(m)) forward('error', m);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const m = `未処理の Promise 拒否: ${stringify(e.reason)}`;
    orig.error(m);
    if (allowForward(m)) forward('error', m);
  });
}

// ---- モニター情報 ----------------------------------------------------------

function describeMonitor(m: MonitorInfo | null): string {
  if (!m) return 'モニター不明';
  return `#${m.index} ${m.name ?? '(no name)'} pos=(${m.x},${m.y}) size=${m.width}x${m.height} scale=${m.scaleFactor}${m.isPrimary ? ' [primary]' : ''}`;
}

async function logMonitor(tag: string) {
  try {
    dlog(`monitor (${tag}):`, describeMonitor(await fetchCurrentMonitor()));
  } catch (e) {
    derr(`monitor (${tag}) の取得に失敗:`, e);
  }
}

// ---- オーバーレイ ----------------------------------------------------------

let overlay: HTMLDivElement | null = null;
let overlayBody: HTMLPreElement | null = null;
let overlayHead: HTMLDivElement | null = null;
let overlayTimer: number | undefined;
let rafId = 0;
let frames = 0;
let fps = 0;
let lastFpsAt = 0;

function tickFps() {
  frames++;
  const now = performance.now();
  if (now - lastFpsAt >= 1000) {
    fps = Math.round((frames * 1000) / (now - lastFpsAt));
    frames = 0;
    lastFpsAt = now;
  }
  rafId = requestAnimationFrame(tickFps);
}

async function refreshOverlay() {
  if (!overlay || !overlayBody || !overlayHead) return;

  let monitor: MonitorInfo | null = null;
  let monitorError = '';
  try {
    monitor = await fetchCurrentMonitor();
  } catch (e) {
    monitorError = stringify(e);
  }

  let fullscreen = '?';
  try {
    fullscreen = String(await getCurrentWindow().isFullscreen());
  } catch {
    /* 取得できなければ ? のまま */
  }

  // await の間に閉じられていたら何もしない
  if (!overlay || !overlayBody || !overlayHead) return;

  const canvas = document.querySelector('canvas');
  overlayHead.textContent = `${WINDOW_LABEL}  /  ${monitor ? `idx ${monitor.index}` : 'idx ?'}`;
  overlayBody.textContent = [
    `monitor : ${monitorError ? `取得失敗: ${monitorError}` : monitor ? (monitor.name ?? '(no name)') : '不明（available_monitors と不一致）'}`,
    monitor ? `pos     : (${monitor.x}, ${monitor.y})` : 'pos     : -',
    monitor ? `size    : ${monitor.width} x ${monitor.height}  scale ${monitor.scaleFactor}` : 'size    : -',
    monitor ? `work    : ${monitor.workWidth} x ${monitor.workHeight} @ (${monitor.workX}, ${monitor.workY})` : 'work    : -',
    monitor ? `primary : ${monitor.isPrimary}` : 'primary : -',
    `viewport: ${window.innerWidth} x ${window.innerHeight}  dpr ${window.devicePixelRatio}`,
    `canvas  : ${canvas ? `${canvas.width} x ${canvas.height}` : 'なし'}`,
    `fullscr : ${fullscreen}`,
    `fps     : ${fps}`,
  ].join('\n');
}

export function toggleDebugOverlay() {
  if (overlay) {
    overlay.remove();
    overlay = null;
    overlayBody = null;
    overlayHead = null;
    window.clearInterval(overlayTimer);
    cancelAnimationFrame(rafId);
    dlog('デバッグ表示: OFF');
    return;
  }

  overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'top:12px',
    'left:12px',
    'z-index:100000',
    'padding:10px 14px',
    'background:rgba(0,0,0,0.78)',
    'border:1px solid #00ffff88',
    'border-radius:6px',
    'color:#00ffff',
    'pointer-events:none',
    'font-family:Consolas,"Courier New",monospace',
  ].join(';');

  overlayHead = document.createElement('div');
  overlayHead.style.cssText = 'font-size:28px;font-weight:bold;margin-bottom:6px;color:#fff';
  overlayBody = document.createElement('pre');
  overlayBody.style.cssText = 'margin:0;font-size:13px;line-height:1.45';

  overlay.append(overlayHead, overlayBody);
  document.body.appendChild(overlay);

  frames = 0;
  lastFpsAt = performance.now();
  rafId = requestAnimationFrame(tickFps);
  void refreshOverlay();
  overlayTimer = window.setInterval(() => void refreshOverlay(), 1000);
  dlog('デバッグ表示: ON');
}

// ---- 初期化 ----------------------------------------------------------------

let initialized = false;

/** main.ts の先頭（他の処理より前）で 1 回呼ぶ。 */
export function initDebug() {
  if (initialized) return;
  initialized = true;

  hookConsole();
  installErrorHandlers();

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      toggleDebugOverlay();
    }
  });

  // トレイの「デバッグ表示」は全ウィンドウに配信される
  listen('toggle-debug-overlay', () => toggleDebugOverlay()).catch((e) =>
    derr('toggle-debug-overlay の購読に失敗:', e),
  );

  dlog('boot', {
    href: location.href,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
  });

  // サブウィンドウは Rust が生成後に位置を移すので、起動直後の値は移動前かもしれない。
  // 起動直後と、落ち着いた後（2 秒後）の両方を記録して比べられるようにする。
  void logMonitor('boot');
  window.setTimeout(() => void logMonitor('2s後'), 2000);
}

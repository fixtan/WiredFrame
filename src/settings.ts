// src/settings.ts
//
// 設定の保存・読み込み（スキーマ v2）。localStorage を使う。
//
//   共通      : GlobalSettings   … 画像フォルダ・マルチモニター。全モニター共通
//   モニター別: MonitorSettings  … 再生・タイル・背景。モニターごと
//
// モニターの設定は次の順で決まる（先に見つかったものを使う）:
//   1. そのモニター専用の保存値   `wiredframe_monitor_v2:<モニターキー>`
//   2. モニター共通の既定値       `wiredframe_monitor_default_v2`
//   3. 組み込みの初期値
// どれを使ったか（source）は、読み込みのたびにログへ出す。
//
// 旧 v1（`wiredframe_settings_v1`）は、初回だけ v2 に移行する。v1 は消さない。

import { dlog, dwarn, derr } from './debug';
import { fetchCurrentMonitor, monitorKeyOf } from './monitor';

export type GlobalSettings = {
  targetDir: string;
  multiMonitor: boolean;
};

export type MonitorSettings = {
  intervalSec: number;
  playMode: string; // 'rotation' | 'random' | 'fixed'
  fixedPattern: string;
  tileSize: number;
  spacingX: number;
  spacingY: number;
  cols: number; // 横に並べる枚数（整数）
  rows: number; // 縦に並べる枚数（整数）
  fitGrid: boolean; // true: グリッド全体が画面に収まるようカメラ距離を自動調整
  bgColor: string;
  bgImagePath: string;
};

/** 画面（フォーム・TileMode）に渡す形。v1 の設定と同じ項目。 */
export type AppSettings = GlobalSettings & MonitorSettings;

export const DEFAULT_GLOBAL: GlobalSettings = {
  targetDir: '',
  multiMonitor: false,
};

export const DEFAULT_MONITOR: MonitorSettings = {
  intervalSec: 12,
  playMode: 'rotation',
  fixedPattern: 'tile',
  tileSize: 2.0,
  spacingX: 4.5,
  spacingY: 2.8,
  cols: 10,
  rows: 6,
  fitGrid: false,
  bgColor: '#000000',
  bgImagePath: '',
};

export const DEFAULT_APP_SETTINGS: AppSettings = { ...DEFAULT_GLOBAL, ...DEFAULT_MONITOR };

/** 保存で全ウィンドウに配信するイベント。受け取った各ウィンドウが設定を読み直して適用する。 */
export const SETTINGS_CHANGED_EVENT = 'settings-changed';

const KEY_V1 = 'wiredframe_settings_v1';
const KEY_V1_MIGRATED = 'wiredframe_v1_migrated';
const KEY_GLOBAL = 'wiredframe_global_v2';
const KEY_MONITOR_DEFAULT = 'wiredframe_monitor_default_v2';
const KEY_MONITOR_PREFIX = 'wiredframe_monitor_v2:';

const PLAY_MODES = ['rotation', 'random', 'fixed'];
// 0 以下だと壊れる項目
const POSITIVE_KEYS = new Set(['intervalSec', 'tileSize', 'spacingX', 'spacingY']);
// 整数で範囲が決まっている項目（cols × rows 枚のテクスチャを作るので上限を設ける）
export const GRID_MIN = 1;
export const GRID_MAX = 40;
const GRID_KEYS = new Set(['cols', 'rows']);

// ---- 内部ヘルパー ----------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 保存値を JSON として読む。無ければ undefined。壊れていたら警告して undefined（=未保存扱い）。 */
function readJson(key: string): unknown {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch (e) {
    derr(`設定: localStorage を読めない (${key}):`, e);
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    dwarn(`設定: 保存値が壊れているので無視する (${key}): ${raw.slice(0, 80)}`);
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    derr(`設定: 保存に失敗 (${key}):`, e);
    throw e;
  }
}

/**
 * 保存値を検証して、`defaults` の項目だけを持つオブジェクトにする。
 * 型が違う・数値が不正な項目は、初期値に置き換えて警告する（どの項目かをログに出す）。
 */
function sanitize<T extends object>(raw: unknown, defaults: T, where: string): T {
  const out = { ...defaults } as Record<string, unknown>;
  if (raw === undefined) return out as T;
  if (!isObject(raw)) {
    dwarn(`設定: ${where} がオブジェクトではない。初期値を使う:`, raw);
    return out as T;
  }
  for (const [k, def] of Object.entries(defaults) as [string, unknown][]) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (typeof v !== typeof def) {
      dwarn(`設定: ${where}.${k} の型が違う（${typeof v}）。初期値 ${JSON.stringify(def)} を使う`);
      continue;
    }
    if (typeof v === 'number' && (!Number.isFinite(v) || (POSITIVE_KEYS.has(k) && v <= 0))) {
      dwarn(`設定: ${where}.${k} の値が不正（${v}）。初期値 ${def} を使う`);
      continue;
    }
    if (GRID_KEYS.has(k) && (!Number.isInteger(v) || (v as number) < GRID_MIN || (v as number) > GRID_MAX)) {
      dwarn(`設定: ${where}.${k} の値が不正（${v}。${GRID_MIN}〜${GRID_MAX} の整数）。初期値 ${def} を使う`);
      continue;
    }
    if (k === 'playMode' && !PLAY_MODES.includes(v as string)) {
      dwarn(`設定: ${where}.playMode が不正（${String(v)}）。初期値 ${String(def)} を使う`);
      continue;
    }
    out[k] = v;
  }
  return out as T;
}

function summarize(s: AppSettings): string {
  return JSON.stringify(s);
}

// ---- v1 → v2 移行 ----------------------------------------------------------

/**
 * v1 の設定が残っていて、v2 がまだ無いときだけ、共通と既定値に分けて移す（1 回だけ）。
 * 複数ウィンドウが同時に起動しても、同じ内容を書くだけなので問題ない。
 */
function migrateV1IfNeeded() {
  if (localStorage.getItem(KEY_V1_MIGRATED) !== null) return;

  const hasV2 =
    localStorage.getItem(KEY_GLOBAL) !== null || localStorage.getItem(KEY_MONITOR_DEFAULT) !== null;
  const v1 = readJson(KEY_V1);

  if (!hasV2 && v1 !== undefined) {
    const g = sanitize(v1, DEFAULT_GLOBAL, 'v1');
    const m = sanitize(v1, DEFAULT_MONITOR, 'v1');
    writeJson(KEY_GLOBAL, g);
    writeJson(KEY_MONITOR_DEFAULT, m);
    dlog('設定: v1 → v2 に移行した', summarize({ ...g, ...m }));
  }
  localStorage.setItem(KEY_V1_MIGRATED, '1');
}

// ---- 読み込み --------------------------------------------------------------

export function loadGlobal(): GlobalSettings {
  migrateV1IfNeeded();
  return sanitize(readJson(KEY_GLOBAL), DEFAULT_GLOBAL, 'global');
}

/** このモニターで使う設定（共通 + モニター別）を読む。`reason` はログ用。 */
export function loadEffectiveSettings(monitorKey: string, reason: string): AppSettings {
  migrateV1IfNeeded();

  const global = sanitize(readJson(KEY_GLOBAL), DEFAULT_GLOBAL, 'global');

  const own = readJson(KEY_MONITOR_PREFIX + monitorKey);
  const def = readJson(KEY_MONITOR_DEFAULT);
  if (own !== undefined && !isObject(own)) dwarn(`設定: モニター別の保存値がオブジェクトではない。無視する (key=${monitorKey})`);
  if (def !== undefined && !isObject(def)) dwarn('設定: モニター共通の既定値がオブジェクトではない。無視する');
  const source = own !== undefined ? 'monitor' : def !== undefined ? 'default' : 'builtin';

  // 専用の保存値に無い項目は、既定値 → 組み込みの順で補う
  const merged = { ...(isObject(def) ? def : {}), ...(isObject(own) ? own : {}) };
  const monitor = sanitize(
    own === undefined && def === undefined ? undefined : merged,
    DEFAULT_MONITOR,
    `monitor(${source})`,
  );

  const settings: AppSettings = { ...global, ...monitor };
  dlog(`設定: 読込 (${reason}) key=${monitorKey} source=${source}`, summarize(settings));
  return settings;
}

// ---- 保存 ------------------------------------------------------------------

export function saveGlobal(g: GlobalSettings) {
  writeJson(KEY_GLOBAL, g);
  dlog('設定: 共通を保存', JSON.stringify(g));
}

/** モニター共通の既定値を保存する（Step 3 までは、設定パネルはこれを編集する）。 */
export function saveMonitorDefault(m: MonitorSettings) {
  writeJson(KEY_MONITOR_DEFAULT, m);
  dlog('設定: モニター共通の既定値を保存', JSON.stringify(m));
}

/** そのモニター専用の設定を保存する。 */
export function saveMonitor(monitorKey: string, m: MonitorSettings) {
  writeJson(KEY_MONITOR_PREFIX + monitorKey, m);
  dlog(`設定: モニター別を保存 key=${monitorKey}`, JSON.stringify(m));
}

/**
 * 設定を初期状態に戻す: 共通・モニター共通の既定値・このモニター専用を消す。
 * 他のモニターの専用設定は消さない。v1 は消さないが、再移行されないよう印を付ける。
 */
export function resetSettings(monitorKey: string) {
  localStorage.removeItem(KEY_GLOBAL);
  localStorage.removeItem(KEY_MONITOR_DEFAULT);
  localStorage.removeItem(KEY_MONITOR_PREFIX + monitorKey);
  localStorage.setItem(KEY_V1_MIGRATED, '1');
  dlog(`設定: 初期状態に戻した key=${monitorKey}`);
}

/** そのモニター専用の保存値だけを消す（共通・既定値・他のモニターは触らない）。 */
export function resetMonitor(monitorKey: string) {
  localStorage.removeItem(KEY_MONITOR_PREFIX + monitorKey);
  dlog(`設定: モニター別を削除（既定値に戻す） key=${monitorKey}`);
}

// ---- 自分のモニターキー ----------------------------------------------------

/** このウィンドウがいるモニターの保存キーを決める。特定できなければ 'unknown'（警告付き）。 */
export async function resolveMonitorKey(): Promise<string> {
  try {
    const m = await fetchCurrentMonitor();
    const key = monitorKeyOf(m);
    if (!m) dwarn("設定: モニターを特定できない。キーは 'unknown' になる");
    else dlog(`設定: モニターキー = ${key}`);
    return key;
  } catch (e) {
    derr("設定: モニター情報の取得に失敗。キーは 'unknown' になる:", e);
    return 'unknown';
  }
}

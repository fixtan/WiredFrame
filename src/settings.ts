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
import { MODE_PARAMS, clampParams, type ParamValues } from './modes/params';

/** 名前を付けた画像フォルダ。リストは全モニター共通。 */
export type FolderEntry = { id: string; name: string; path: string };

export type GlobalSettings = {
  folders: FolderEntry[]; // 画像フォルダのリスト
  defaultFolderId: string; // 「共通の既定」を選んだモニターが使うフォルダ（folders の id。リストが空なら ''）
  multiMonitor: boolean;
  hotkey: string; // 起動ホットキー（例 'Ctrl+Alt+S'）。空なら無効
  idleEnabled: boolean; // 無操作で自動起動するか
  idleMinutes: number; // 自動起動までの無操作時間（分、整数）
  idleExitOnInput: boolean; // 自動起動したセーバーを、キー・マウス操作で終了するか（false なら ESC だけ）
};

export type MonitorSettings = {
  mode: string; // 'tiles'（画像タイル）| 'noise1'（カールノイズの粒子）| 'noise2'（Mandelbulb）| 'noise3'（ワイヤーフレーム地形）| 'noise4'（ドメインワーピング）| 'noise5'（ルーン）| 'noise6'（万華鏡）
  noiseSize: number; // ノイズの粒子テクスチャの一辺（粒子数は二乗）。負荷に直結する
  fps: number; // FPS の上限（整数）
  modeParams: Record<string, ParamValues>; // モードごとの調整値（src/modes/params.ts）。無い項目は既定値
  intervalSec: number;
  playMode: string; // 'rotation' | 'random' | 'fixed'
  fixedPattern: string;
  folderId: string; // このモニターの画像フォルダ（folders の id）。'' なら共通の既定
  tileSize: number;
  spacingX: number;
  spacingY: number;
  cols: number; // 横に並べる枚数（整数）
  rows: number; // 縦に並べる枚数（整数）
  fitGrid: boolean; // true: グリッド全体が画面に収まるようカメラ距離を自動調整
  brightness: number; // 明るさ（%、整数 10〜100）。タイルと背景に掛ける
  bgColor: string;
  bgImagePath: string;
};

/**
 * 画面（フォーム・TileMode）に渡す形。`targetDir` は、このモニターで実際に使う画像フォルダのパス
 * （folderId → 共通の既定 → 未設定 '' の順で決まる）。保存はされない（計算で出す）。
 */
export type AppSettings = GlobalSettings & MonitorSettings & { targetDir: string };

export const DEFAULT_GLOBAL: GlobalSettings = {
  folders: [],
  defaultFolderId: '',
  multiMonitor: false,
  hotkey: '',
  idleEnabled: false,
  idleMinutes: 10,
  idleExitOnInput: false,
};

export const DEFAULT_MONITOR: MonitorSettings = {
  mode: 'tiles',
  noiseSize: 384,
  fps: 60,
  modeParams: {},
  intervalSec: 12,
  playMode: 'rotation',
  fixedPattern: 'tile',
  folderId: '',
  tileSize: 2.0,
  spacingX: 4.5,
  spacingY: 2.8,
  cols: 10,
  rows: 6,
  fitGrid: false,
  brightness: 100,
  bgColor: '#000000',
  bgImagePath: '',
};

export const DEFAULT_APP_SETTINGS: AppSettings = { ...DEFAULT_GLOBAL, ...DEFAULT_MONITOR, targetDir: '' };

/** 保存で全ウィンドウに配信するイベント。受け取った各ウィンドウが設定を読み直して適用する。 */
export const SETTINGS_CHANGED_EVENT = 'settings-changed';

const KEY_V1 = 'wiredframe_settings_v1';
const KEY_V1_MIGRATED = 'wiredframe_v1_migrated';
const KEY_GLOBAL = 'wiredframe_global_v2';
const KEY_MONITOR_DEFAULT = 'wiredframe_monitor_default_v2';
const KEY_MONITOR_PREFIX = 'wiredframe_monitor_v2:';

const PLAY_MODES = ['rotation', 'random', 'fixed'];
export const MODES = ['tiles', 'noise1', 'noise2', 'noise3', 'noise4', 'noise5', 'noise6'];
// 0 以下だと壊れる項目
const POSITIVE_KEYS = new Set(['intervalSec', 'tileSize', 'spacingX', 'spacingY']);
// 整数で範囲が決まっている項目（cols × rows 枚のテクスチャを作るので上限を設ける）
export const GRID_MIN = 1;
export const GRID_MAX = 40;
export const BRIGHTNESS_MIN = 10;
export const BRIGHTNESS_MAX = 100;
export const NOISE_SIZE_MIN = 128;
export const NOISE_SIZE_MAX = 512;
export const FPS_MIN = 10;
export const FPS_MAX = 120;
export const IDLE_MIN = 1;
export const IDLE_MAX = 720;
const INT_RANGES: Record<string, [number, number]> = {
  cols: [GRID_MIN, GRID_MAX],
  rows: [GRID_MIN, GRID_MAX],
  idleMinutes: [IDLE_MIN, IDLE_MAX],
  brightness: [BRIGHTNESS_MIN, BRIGHTNESS_MAX],
  noiseSize: [NOISE_SIZE_MIN, NOISE_SIZE_MAX],
  fps: [FPS_MIN, FPS_MAX],
};

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
    if (k === 'folders' || k === 'modeParams') continue; // 配列。normalizeGlobal で個別に検証する
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
    const range = INT_RANGES[k];
    if (range && (!Number.isInteger(v) || (v as number) < range[0] || (v as number) > range[1])) {
      dwarn(`設定: ${where}.${k} の値が不正（${v}。${range[0]}〜${range[1]} の整数）。初期値 ${def} を使う`);
      continue;
    }
    if (k === 'playMode' && !PLAY_MODES.includes(v as string)) {
      dwarn(`設定: ${where}.playMode が不正（${String(v)}）。初期値 ${String(def)} を使う`);
      continue;
    }
    if (k === 'mode' && !MODES.includes(v as string)) {
      dwarn(`設定: ${where}.mode が不正（${String(v)}）。初期値 ${String(def)} を使う`);
      continue;
    }
    out[k] = v;
  }
  if ('modeParams' in defaults) {
    (out as Record<string, unknown>).modeParams = sanitizeModeParams(isObject(raw) ? raw.modeParams : undefined, where);
  }
  return out as T;
}

/** モードごとの調整値を検証する。未知のモードは捨て、値は定義の範囲に丸める。 */
function sanitizeModeParams(v: unknown, where: string): Record<string, ParamValues> {
  const out: Record<string, ParamValues> = {};
  if (v === undefined) return out;
  if (!isObject(v)) {
    dwarn(`設定: ${where}.modeParams がオブジェクトではない。無視する:`, v);
    return out;
  }
  for (const [mode, vals] of Object.entries(v)) {
    const defs = MODE_PARAMS[mode];
    if (!defs) continue;
    out[mode] = clampParams(defs, vals);
  }
  return out;
}

// ---- 画像フォルダのリスト ---------------------------------------------------

/** フォルダリストを検証する。壊れた項目（id・パスが無い、id の重複）は警告して捨てる。 */
function sanitizeFolders(v: unknown, where: string): FolderEntry[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    dwarn(`設定: ${where}.folders が配列ではない。空のリストにする:`, v);
    return [];
  }
  const out: FolderEntry[] = [];
  const seen = new Set<string>();
  v.forEach((f, i) => {
    if (!isObject(f) || typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.path !== 'string' || !f.id || !f.path) {
      dwarn(`設定: ${where}.folders[${i}] が不正なので捨てる:`, f);
      return;
    }
    if (seen.has(f.id)) {
      dwarn(`設定: ${where}.folders[${i}] の id が重複している（${f.id}）ので捨てる`);
      return;
    }
    seen.add(f.id);
    out.push({ id: f.id, name: f.name, path: f.path });
  });
  return out;
}

/**
 * 共通設定を検証して整える。旧形式（`targetDir` だけ持つ）は、1 件のフォルダリストに移す。
 * `defaultFolderId` がリストに無ければ、先頭の項目（リストが空なら ''）にする。
 */
function normalizeGlobal(raw: unknown, where: string): GlobalSettings {
  const g = sanitize(raw, DEFAULT_GLOBAL, where);
  g.folders = sanitizeFolders(isObject(raw) ? raw.folders : undefined, where);
  if (isObject(raw) && !('folders' in raw) && typeof raw.targetDir === 'string' && raw.targetDir) {
    g.folders = [{ id: 'f1', name: 'デフォルト', path: raw.targetDir }];
    g.defaultFolderId = 'f1';
    dlog(`設定: 旧 targetDir をフォルダリストに移した（${where}）: ${raw.targetDir}`);
  }
  if (!g.folders.some((f) => f.id === g.defaultFolderId)) {
    if (g.defaultFolderId) dwarn(`設定: ${where}.defaultFolderId（${g.defaultFolderId}）がリストに無い。先頭を使う`);
    g.defaultFolderId = g.folders[0]?.id ?? '';
  }
  return g;
}

/** このモニターが使うフォルダを決める（folderId → 共通の既定 → 無し）。 */
export function resolveFolder(
  g: Pick<GlobalSettings, 'folders' | 'defaultFolderId'>,
  folderId: string,
): { folder: FolderEntry | null; usedDefault: boolean; missing: boolean } {
  let missing = false;
  if (folderId) {
    const f = g.folders.find((x) => x.id === folderId);
    if (f) return { folder: f, usedDefault: false, missing: false };
    missing = true; // 指定されたフォルダがリストから消えている
  }
  const d = g.folders.find((x) => x.id === g.defaultFolderId) ?? null;
  return { folder: d, usedDefault: true, missing };
}

/** 新しいフォルダの id（既存と重ならない）。 */
export function newFolderId(existing: FolderEntry[]): string {
  const used = new Set(existing.map((f) => f.id));
  for (;;) {
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    if (!used.has(id)) return id;
  }
}

function summarize(s: object): string {
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
    const g = normalizeGlobal(v1, 'v1');
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
  return normalizeGlobal(readJson(KEY_GLOBAL), 'global');
}

/** このモニターで使う設定（共通 + モニター別）を読む。`reason` はログ用。 */
export function loadEffectiveSettings(monitorKey: string, reason: string): AppSettings {
  migrateV1IfNeeded();

  const global = normalizeGlobal(readJson(KEY_GLOBAL), 'global');

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

  const r = resolveFolder(global, monitor.folderId);
  if (r.missing) dwarn(`設定: 指定の画像フォルダ（${monitor.folderId}）がリストに無い。共通の既定を使う (key=${monitorKey})`);
  const settings: AppSettings = { ...global, ...monitor, targetDir: r.folder?.path ?? '' };
  dlog(
    `設定: 読込 (${reason}) key=${monitorKey} source=${source} folder=${r.folder ? `${r.folder.name}${r.usedDefault ? '（共通の既定）' : ''}` : '未設定'}`,
    summarize(settings),
  );
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

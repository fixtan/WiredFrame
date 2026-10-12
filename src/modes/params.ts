// src/modes/params.ts
//
// モードごとの「調整できるパラメータ」の定義。設定パネルはこの定義からスライダーを自動で作る。
// 値はモニターごとに `MonitorSettings.modeParams[モード名][key]` として保存される。
//
// 新しいモードに調整項目を付けるには:
//   1. ここに ParamDef の配列を書き、MODE_PARAMS に登録する
//   2. モードの実装で IMode.setParams(values) を受け取り、値を反映する（無い key は default を使う）
// 画面側（設定パネル・保存・初期値に戻す）は何も変えなくてよい。

export type ParamDef = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type ParamValues = Record<string, number>;

export const NOISE1_PARAMS: ParamDef[] = [
  { key: 'particleSize', label: '粒子の大きさ', min: 10, max: 150, step: 1, default: 60 },
  { key: 'speed', label: '流れの速さ', min: 0.005, max: 0.1, step: 0.005, default: 0.03 },
  { key: 'swirl', label: '渦の大きさ（小さいほど大きな渦）', min: 0.02, max: 0.4, step: 0.01, default: 0.1 },
  { key: 'life', label: '寿命の減り（小さいほど尾が長い）', min: 0.0002, max: 0.01, step: 0.0002, default: 0.001 },
  { key: 'pulse', label: '脈動の強さ', min: 0, max: 5, step: 0.1, default: 1.5 },
  { key: 'colorCycle', label: '色が一周する秒数', min: 10, max: 600, step: 10, default: 150 },
  { key: 'orbit', label: '自動回転で一周する秒数', min: 10, max: 600, step: 10, default: 40 },
  { key: 'distance', label: 'カメラの距離（マウスのホイールでも変えられる）', min: 5, max: 60, step: 1, default: 20 },
];

export const NOISE2_PARAMS: ParamDef[] = [
  { key: 'renderScale', label: '描画の解像度（小さいほど軽い）', min: 0.25, max: 1, step: 0.05, default: 0.5 },
  { key: 'steps', label: 'レイの最大ステップ数（小さいほど軽い）', min: 20, max: 100, step: 5, default: 70 },
  { key: 'iterations', label: 'フラクタルの反復回数（小さいほど軽い）', min: 2, max: 8, step: 1, default: 5 },
  { key: 'power', label: '形の複雑さ', min: 2, max: 15, step: 0.1, default: 8 },
  { key: 'iri', label: '虹色の強さ', min: 0.1, max: 5, step: 0.1, default: 2.5 },
  { key: 'colorSpeed', label: '色の変わる速さ', min: 0, max: 1, step: 0.05, default: 0.2 },
  { key: 'orbit', label: '自動回転で一周する秒数', min: 20, max: 600, step: 10, default: 60 },
  { key: 'distance', label: 'カメラの距離（マウスのホイールでも変えられる）', min: 1.5, max: 10, step: 0.1, default: 3.6 },
  { key: 'meteors', label: '降ってくる粒の数', min: 0, max: 2000, step: 100, default: 2000 },
  { key: 'bloom', label: '光のにじみ（0 でオフ。オフが軽い）', min: 0, max: 2, step: 0.1, default: 0.5 },
];

/** モード名 → 調整項目。ここに無いモード（タイルなど）には調整欄が出ない。 */
export const MODE_PARAMS: Record<string, ParamDef[]> = {
  noise1: NOISE1_PARAMS,
  noise2: NOISE2_PARAMS,
};

export function paramDefaults(defs: ParamDef[]): ParamValues {
  return Object.fromEntries(defs.map((d) => [d.key, d.default]));
}

/** 値を定義に合わせて整える（数値でない・範囲外は default / 端に丸める。未知の key は捨てる）。 */
export function clampParams(defs: ParamDef[], raw: unknown): ParamValues {
  const out = paramDefaults(defs);
  if (typeof raw !== 'object' || raw === null) return out;
  for (const d of defs) {
    const v = (raw as Record<string, unknown>)[d.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[d.key] = Math.min(d.max, Math.max(d.min, v));
  }
  return out;
}

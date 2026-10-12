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

export const NOISE3_PARAMS: ParamDef[] = [
  { key: 'size', label: '地形の範囲（広げると遠くまで続く）', min: 10, max: 200, step: 2, default: 24 },
  { key: 'segments', label: '分割数（多いほど細かいが重い）', min: 64, max: 512, step: 32, default: 320 },
  { key: 'fog', label: '霧で消える距離（0 でオフ。範囲の半分くらいで端が見えなくなる）', min: 0, max: 300, step: 2, default: 16 },
  { key: 'height', label: '山の高さ', min: 0.2, max: 4, step: 0.1, default: 1.5 },
  { key: 'noiseScale', label: '山の細かさ（大きいほど起伏が細かい）', min: 0.5, max: 8, step: 0.1, default: 2 },
  { key: 'detail', label: '細部の層の数', min: 1, max: 6, step: 1, default: 4 },
  { key: 'roughness', label: '細部の強さ（大きいほどギザギザ）', min: 0.2, max: 0.8, step: 0.05, default: 0.5 },
  { key: 'swell', label: 'うねり（山が上下にゆっくり増減）', min: 0, max: 2, step: 0.1, default: 0.5 },
  { key: 'speed', label: '波打つ速さ', min: 0, max: 4, step: 0.1, default: 1 },
  { key: 'spin', label: '地形の回転の速さ（0 で止める）', min: 0, max: 0.3, step: 0.01, default: 0.06 },
  { key: 'lowHue', label: '低い所の色（色相 0〜360）', min: 0, max: 360, step: 1, default: 218 },
  { key: 'highHue', label: '高い所の色（色相 0〜360）', min: 0, max: 360, step: 1, default: 121 },
  { key: 'saturation', label: '色の鮮やかさ', min: 0, max: 1, step: 0.05, default: 0.6 },
  { key: 'lowLight', label: '低い所の明るさ', min: 0.05, max: 0.8, step: 0.01, default: 0.43 },
  { key: 'highLight', label: '高い所の明るさ', min: 0.05, max: 0.8, step: 0.01, default: 0.4 },
  { key: 'colorMix', label: '高い所の色の出方（0 で低い所の色だけ）', min: 0, max: 1, step: 0.05, default: 0.8 },
  { key: 'colorContrast', label: '高低の色の差（大きいほどくっきり）', min: 0.5, max: 5, step: 0.1, default: 2 },
  { key: 'distance', label: 'カメラの距離（マウスのホイールでも変えられる）', min: 1, max: 40, step: 0.5, default: 4.5 },
];

export const NOISE4_PARAMS: ParamDef[] = [
  { key: 'renderScale', label: '描画の解像度（小さいほど軽い。ぼかした絵なので 0.5 でも綺麗）', min: 0.25, max: 1, step: 0.05, default: 0.5 },
  { key: 'detail', label: '細部の層の数（小さいほど軽い）', min: 1, max: 6, step: 1, default: 4 },
  { key: 'noiseScale', label: '模様の細かさ', min: 0.1, max: 10, step: 0.1, default: 1.5 },
  { key: 'warp', label: '歪みの強さ', min: 0, max: 3, step: 0.1, default: 0.5 },
  { key: 'speed', label: '動く速さ', min: 0, max: 4, step: 0.1, default: 1 },
  { key: 'pulse', label: '脈動の強さ（0 でオフ）', min: 0, max: 2, step: 0.05, default: 0.0 },
  { key: 'bpm', label: '脈動の速さ（1 分あたりの拍数）', min: 20, max: 180, step: 1, default: 60 },
  { key: 'glow', label: '脈動で光る強さ', min: 0, max: 2, step: 0.02, default: 0.22 },
  { key: 'hue', label: '光る色（色相 0〜360。0 が赤）', min: 0, max: 360, step: 1, default: 0 },
  { key: 'colorCycle', label: '色が一周する秒数（0 で固定）', min: 0, max: 600, step: 10, default: 150 },
  { key: 'saturation', label: '色の鮮やかさ', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'glowLight', label: '光る色の明るさ', min: 0.1, max: 0.8, step: 0.01, default: 0.5 },
  { key: 'baseLight', label: '暗い所の明るさ（ほぼ黒）', min: 0, max: 0.3, step: 0.005, default: 0.025 },
];

/** モード名 → 調整項目。ここに無いモード（タイルなど）には調整欄が出ない。 */
export const MODE_PARAMS: Record<string, ParamDef[]> = {
  noise1: NOISE1_PARAMS,
  noise2: NOISE2_PARAMS,
  noise3: NOISE3_PARAMS,
  noise4: NOISE4_PARAMS,
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

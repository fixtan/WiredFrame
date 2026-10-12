// src/core/IMode.ts


import * as THREE from 'three';

export interface IMode {
  init(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer?: THREE.WebGLRenderer): void;
  /** 明るさ（%）。モードごとに見た目へ反映する */
  setBrightness?(percent: number): void;
  /** 調整パラメータ（src/modes/params.ts の定義）。いつでも呼ばれ、その場で反映する */
  /** 描画の解像度の倍率（1 = 等倍）。重いモードが下げる。AppManager が反映する */
  getRenderScale?(): number;
  /** 描画を自前で行う（ポストエフェクトなど）。無ければ renderer.render(scene, camera) */
  render?(renderer: THREE.WebGLRenderer): void;
  setParams?(values: Record<string, number>): void;
  update(delta: number, time: number): void;
  onKeyDown?(event: KeyboardEvent): void;
  onPointerMove?(event: PointerEvent): void;
  /** ウィンドウのサイズが変わった（カメラの aspect 更新後）に呼ばれる */
  onResize?(): void;
  dispose(): void;
}

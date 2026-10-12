// src/core/IMode.ts


import * as THREE from 'three';

export interface IMode {
  init(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  update(delta: number, time: number): void;
  onKeyDown?(event: KeyboardEvent): void;
  onPointerMove?(event: PointerEvent): void;
  /** ウィンドウのサイズが変わった（カメラの aspect 更新後）に呼ばれる */
  onResize?(): void;
  dispose(): void;
}

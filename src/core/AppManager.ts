// src/core/AppManager.ts

import * as THREE from 'three';
import { IMode } from './IMode';

export class AppManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private currentMode: IMode | null = null;
  // THREE.Clock は非推奨。Timer は update() で時刻を進めてから delta / elapsed を読む
  private timer = new THREE.Timer();

  constructor(container: HTMLElement) {
    // シーン・カメラ・レンダラーの初期化
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 50);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // イベントリスナーの登録
    window.addEventListener('resize', this.onWindowResize.bind(this));
    window.addEventListener('keydown', (e) => this.currentMode?.onKeyDown?.(e));
    window.addEventListener('pointermove', (e) => this.currentMode?.onPointerMove?.(e));

    this.animate();
  }

  // モードを切り替える関数（「Tキーでタイル、Nキーでノイズ1へ…」などの切り替えが可能に）
  public switchMode(newMode: IMode) {
    if (this.currentMode) {
      this.currentMode.dispose();
      // シーン内を一度クリア
      this.scene.clear();
    }
    this.currentMode = newMode;
    this.currentMode.init(this.scene, this.camera);
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.currentMode?.onResize?.();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    this.timer.update();
    const delta = this.timer.getDelta();
    const time = this.timer.getElapsed();

    this.currentMode?.update(delta, time);
    this.renderer.render(this.scene, this.camera);
  };
}

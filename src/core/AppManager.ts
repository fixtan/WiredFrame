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
  // FPS 上限（0 = 制限しない）。複数モニターで GPU 負荷を抑えるために使う
  // 描画解像度の倍率。重いモードが下げる（切り替えのたびに 1 に戻す）
  private renderScale = 1;
  private minFrameMs = 0;
  private lastRenderAt = 0;

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
      this.currentMode = null; // 破棄したモードに onResize などが呼ばれないように
      // シーン内を一度クリア
      this.scene.clear();
    }
    // 前のモードが残した背景・霧を消してから始める
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.backgroundIntensity = 1;
    this.setRenderScale(1);
    this.currentMode = newMode;
    this.currentMode.init(this.scene, this.camera, this.renderer);
  }

  /** 描画解像度の倍率（0.25〜1）。CSS の大きさは変えず、内部の解像度だけ下げて引き伸ばす */
  public setRenderScale(scale: number) {
    const s = Math.min(1, Math.max(0.25, scale));
    if (Math.abs(s - this.renderScale) < 1e-3) return;
    this.renderScale = s;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * s);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.currentMode?.onResize?.();
  }

  /** FPS の上限。0 以下なら制限しない（モニターのリフレッシュレートに任せる） */
  public setFpsLimit(fps: number) {
    this.minFrameMs = fps > 0 ? 1000 / fps : 0;
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.currentMode?.onResize?.();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    if (this.minFrameMs > 0) {
      const now = performance.now();
      // rAF の刻みとずれるので、1 フレーム分から少し余裕を引いて判定する
      if (now - this.lastRenderAt < this.minFrameMs - 2) return;
      this.lastRenderAt = now;
    }
    this.timer.update();
    const delta = this.timer.getDelta();
    const time = this.timer.getElapsed();

    this.currentMode?.update(delta, time);
    const mode = this.currentMode;
    if (mode?.render) mode.render(this.renderer);
    else this.renderer.render(this.scene, this.camera);
  };
}

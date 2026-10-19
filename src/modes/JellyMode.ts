// src/modes/JellyMode.ts
//
// ゼリー。ぷにぷにしたゼリーが跳ね回り、同じ色どうしがぶつかると合体して大きく育つ。
// いちばん大きく育つと「臨界点」の演出があり、そのあとは、ぶつかるたびに半分に分かれて小さくなり、また育つ。
//
// 物理は src/modes/jelly/JellyWorld.ts（three.js に依存しない）。ここでは
//   - Canvas2D にゼリーを描き、全画面の板のテクスチャとして貼る（カメラは使わない）
//   - 設定パネルのパラメータを物理に渡す
// だけを行う。物理は 60Hz 固定刻み。物理が進んだフレームだけ描き直してテクスチャを送る。
//
// 負荷: ゼリーが増えるほど（分裂フェーズの下限の段を下げるほど）重くなる。「個数の上限」と
// 「描画の解像度」で調整する。箱の高さは固定（BOX_H）で、幅は画面の縦横比で決まるので、横長の画面ほど個数が増える。

import * as THREE from 'three';
import { IMode } from '../core/IMode';
import { JELLY_PARAMS, clampParams, type ParamValues } from './params';
import { BOX_H, JellyWorld, type Jelly } from './jelly/JellyWorld';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // カメラに関係なく画面全体
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D u_tex;
  uniform float u_gain;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(u_tex, vUv).rgb * u_gain, 1.0);
  }
`;

const BG = '#0a0a14';
const MAX_CANVAS_H = 1440; // 4K でも、描画はこの高さまで（引き伸ばす）

export class JellyMode implements IMode {
  private scene!: THREE.Scene;
  private mesh: THREE.Mesh | null = null;
  private geo: THREE.PlaneGeometry | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private world: JellyWorld;
  private p: ParamValues = clampParams(JELLY_PARAMS, {});
  private brightness = 100;
  private quality = 0.75;
  private scale = 1; // 箱の座標 → キャンバスのピクセル
  private dirty = true;

  constructor() {
    this.world = new JellyWorld(BOX_H * (window.innerWidth / Math.max(1, window.innerHeight)));
    this.applyParams();
  }

  private gain(): number {
    return Math.pow(this.brightness / 100, 2.2);
  }

  setBrightness(percent: number) {
    this.brightness = percent;
    if (this.mat) this.mat.uniforms.u_gain.value = this.gain();
  }

  setParams(values: ParamValues) {
    this.p = clampParams(JELLY_PARAMS, values);
    this.applyParams();
  }

  private applyParams() {
    const p = this.p;
    const sizeChanged = this.world.setParams({
      soft: p.soft,
      press: p.press,
      speed: p.speed,
      fill: p.fill,
      sizeScale: p.sizeScale,
      amoeba: p.amoeba,
      mergeDelaySec: p.mergeDelay,
      splitCoolSec: p.splitCool,
      minCls: Math.round(p.minCls),
      evSec: p.evSec,
      splitCap: Math.round(p.splitCap),
    });
    if (sizeChanged) this.world.reset(); // ゼリーの大きさが変わったら、初めからやり直す
    if (Math.abs(p.quality - this.quality) > 1e-3) {
      this.quality = p.quality;
      this.resizeCanvas();
    }
  }

  init(scene: THREE.Scene, _camera: THREE.PerspectiveCamera, _renderer?: THREE.WebGLRenderer) {
    this.scene = scene;
    scene.background = new THREE.Color(BG);

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace; // 色はそのまま画面へ（NoiseMode と同じ扱い）
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;

    this.mat = new THREE.ShaderMaterial({
      uniforms: { u_tex: { value: this.tex }, u_gain: { value: this.gain() } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.onResize();
  }

  /** キャンバスの大きさを画面に合わせる（箱は高さ固定・幅は縦横比で決まる） */
  private resizeCanvas() {
    if (!this.canvas) return;
    const h = Math.max(120, Math.min(MAX_CANVAS_H, Math.round(window.innerHeight * this.quality)));
    const w = Math.max(120, Math.round(h * (window.innerWidth / Math.max(1, window.innerHeight))));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      // テクスチャの大きさが変わるので、作り直してもらう
      this.tex?.dispose();
    }
    this.scale = h / BOX_H;
    this.dirty = true;
  }

  onResize() {
    // 縦横比が変わったら箱の幅も変わるので、初めからやり直す
    const boxW = BOX_H * (window.innerWidth / Math.max(1, window.innerHeight));
    if (Math.abs(boxW - this.world.W) > 1) {
      this.world.setBox(boxW);
      this.world.reset();
    }
    this.resizeCanvas();
  }

  update(delta: number, _time: number) {
    if (!this.ctx || !this.tex) return;
    if (this.world.advance(delta) || this.dirty) {
      this.draw();
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }

  // ===== 描画 =====
  private path(ctx: CanvasRenderingContext2D, j: Jelly) {
    const p = j.p;
    const n = j.n;
    ctx.beginPath();
    ctx.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2);
    for (let i = 0; i < n; i++) {
      const a = p[i];
      const b = p[(i + 1) % n];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.closePath();
  }

  private draw() {
    const ctx = this.ctx!;
    const cv = this.canvas!;
    const w = this.world;
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);

    ctx.save();
    const ev = w.ev;
    const evFrames = Math.max(1, this.p.evSec * 60);
    if (ev) {
      // 画面の揺れ（前半で減衰）
      const a = 7 * Math.max(0, 1 - ev.t / (evFrames * 0.5));
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    }
    for (const j of w.jellies) {
      const [cx, cy] = j.center();
      this.path(ctx, j);
      ctx.fillStyle = `hsl(${j.hue} 90% 58%)`;
      ctx.fill();
      ctx.save();
      this.path(ctx, j);
      ctx.clip();
      const g = ctx.createRadialGradient(cx - j.r * 0.35, cy - j.r * 0.45, 1, cx - j.r * 0.2, cy - j.r * 0.3, j.r * 1.2);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - j.r * 3, cy - j.r * 3, j.r * 6, j.r * 6);
      ctx.restore();
      this.path(ctx, j);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `hsl(${j.hue} 90% 30%)`;
      ctx.stroke();
    }
    for (const f of w.fx) {
      const k = f.t / (f.L || 30);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1 + k * (f.g || 1.8)), 0, 6.283);
      ctx.lineWidth = 3 * (1 - k);
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`;
      ctx.stroke();
    }
    ctx.restore();
    if (ev && ev.t < 40) {
      // 一瞬の光
      const k = 1 - ev.t / 40;
      ctx.fillStyle = `rgba(255,255,255,${0.75 * k * k})`;
      ctx.fillRect(0, 0, w.W, w.H);
    }
  }

  dispose() {
    if (this.mesh) this.scene.remove(this.mesh);
    this.geo?.dispose();
    this.mat?.dispose();
    this.tex?.dispose();
    this.mesh = null;
    this.geo = null;
    this.mat = null;
    this.tex = null;
    this.ctx = null;
    this.canvas = null;
    this.scene.background = null;
  }
}

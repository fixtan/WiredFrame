// src/modes/NoiseMode4.ts
//
// ドメインワーピング（fbm ノイズで座標を歪めて、もう一度 fbm を引く）の全画面シェーダー。
// 元ネタ: [Noise #56] Audio Analysis & FFT - Audio Reactive Domain Warping（未公開だった作品）。
// 音との連動・FFT 表示は外した。元が音が無いときに使っていた 128BPM の擬似ビートは、
// 「脈動」（強さと速さを調整できる）として残した。
//
// カメラは使わない（頂点シェーダーが画面全体に直接貼る）。マウス操作も無い。
// 負荷は画面のピクセル数に比例する（全ピクセルで fbm を 3 回）。重い場合は描画の解像度を下げる。

import * as THREE from 'three';
import { IMode } from '../core/IMode';
import { NOISE4_PARAMS, clampParams, type ParamValues } from './params';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // カメラに関係なく画面全体
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float u_time;
  uniform float u_aspect;
  uniform float u_bass;       // 脈動（0〜1 を pulse 倍したもの）
  uniform float u_noise_scale;
  uniform float u_warp_strength;
  uniform float u_glow_intensity;
  uniform float u_gain;
  uniform int u_oct;
  uniform vec3 u_color_base;
  uniform vec3 u_color_glow;
  varying vec2 vUv;

  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p) {
    float value = 0.0; float amplitude = 0.5; float frequency = 1.0;
    for (int i = 0; i < 6; i++) {
      if (i >= u_oct) break;
      value += amplitude * snoise(p * frequency);
      p = p * 2.0 + vec2(100.0);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 st = vUv * 2.0 - 1.0;
    st.x *= u_aspect;

    // 脈動で「時間の進み」を局所的に変える
    float timeMod = u_time + u_bass * 2.5;

    // Domain Warping
    vec2 q = vec2(0.0);
    q.x = fbm(st * u_noise_scale + timeMod * 0.2);
    q.y = fbm(st * u_noise_scale - timeMod * 0.3);

    // 脈動で「歪みの強さ」を変化させる
    float currentWarp = u_warp_strength + pow(u_bass, 1.2) * 4.0;
    vec2 warpedSt = st + q * currentWarp;

    // メインノイズ
    float n = fbm(warpedSt * u_noise_scale + (u_time * 0.5));
    n = n * 0.5 + 0.5;

    vec3 color = mix(u_color_base, u_color_glow, n);

    // 白飛び対策: 単純加算ではなく、n（密度）の高い場所を優先的に光らせる
    float flash = pow(u_bass, 1.5) * u_glow_intensity;
    color += u_color_glow * flash * n;

    color = smoothstep(0.0, 1.1, color);
    gl_FragColor = vec4(color * u_gain, 1.0);
  }
`;

export class NoiseMode4 implements IMode {
  private scene!: THREE.Scene;

  private p: ParamValues = clampParams(NOISE4_PARAMS, undefined);
  private brightness = 100;
  // 速さ・色の速さをその場で変えても飛ばないよう、時間ではなく積算で持つ
  private flow = 0;
  private huePhase = 0;
  private beat = 0;
  private bass = 0;

  private geo: THREE.PlaneGeometry | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;

  private gain(): number {
    return Math.pow(this.brightness / 100, 2.2);
  }

  setBrightness(percent: number) {
    this.brightness = percent;
    if (this.mat) this.mat.uniforms.u_gain.value = this.gain();
  }

  getRenderScale(): number {
    return this.p.renderScale;
  }

  setParams(values: ParamValues) {
    this.p = clampParams(NOISE4_PARAMS, values);
    this.applyParams();
  }

  private applyParams() {
    if (!this.mat) return;
    const u = this.mat.uniforms;
    u.u_noise_scale.value = this.p.noiseScale;
    u.u_warp_strength.value = this.p.warp;
    u.u_glow_intensity.value = this.p.glow;
    u.u_oct.value = Math.round(this.p.detail);
    this.applyColors();
  }

  /** 色。元の色（#05070a / #ff0000）は sRGB の文字列を linear にして出力していたので、HSL も sRGB として解釈して合わせる */
  private applyColors() {
    if (!this.mat) return;
    const p = this.p;
    const u = this.mat.uniforms;
    const hue = (((p.hue + this.huePhase * 360) % 360) + 360) % 360;
    (u.u_color_glow.value as THREE.Color).setHSL(hue / 360, p.saturation, p.glowLight, THREE.SRGBColorSpace);
    (u.u_color_base.value as THREE.Color).setHSL(215 / 360, 0.5, p.baseLight, THREE.SRGBColorSpace);
  }

  init(scene: THREE.Scene, _camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    scene.background = new THREE.Color(0x000000);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        u_time: { value: 0 },
        u_aspect: { value: window.innerWidth / window.innerHeight },
        u_bass: { value: 0 },
        u_noise_scale: { value: this.p.noiseScale },
        u_warp_strength: { value: this.p.warp },
        u_glow_intensity: { value: this.p.glow },
        u_gain: { value: this.gain() },
        u_oct: { value: Math.round(this.p.detail) },
        u_color_base: { value: new THREE.Color() },
        u_color_glow: { value: new THREE.Color() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    // 頂点はクリップ座標で直接決まる。カメラの視錐台で消されないように
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.applyColors();
  }

  onResize() {
    if (this.mat) this.mat.uniforms.u_aspect.value = window.innerWidth / window.innerHeight;
  }

  update(delta: number, _time: number) {
    if (!this.mat) return;
    const p = this.p;
    this.flow += delta * p.speed;
    if (p.colorCycle > 0) {
      this.huePhase = (this.huePhase + delta / p.colorCycle) % 1;
      this.applyColors();
    }

    // 元の擬似ビート: 拍の頭で 1 になり、指数で減る。さらになめらかにして（元と同じ 0.15）使う
    const interval = 60 / p.bpm;
    this.beat = (this.beat + delta) % interval;
    const target = Math.exp(-this.beat * 5);
    this.bass += (target - this.bass) * Math.min(1, 0.15 * delta * 60);

    this.mat.uniforms.u_time.value = this.flow;
    this.mat.uniforms.u_bass.value = this.bass * p.pulse;
  }

  dispose() {
    if (this.mesh) this.scene.remove(this.mesh);
    this.geo?.dispose();
    this.mat?.dispose();
    this.mesh = null;
    this.geo = null;
    this.mat = null;
    this.scene.background = null;
  }
}

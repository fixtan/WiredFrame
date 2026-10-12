// src/modes/NoiseMode6.ts
//
// 万華鏡（オリジナル）。ドメインワーピングしたノイズで滑らかな凹凸を作り、角度の鏡（N 枚）と
// 半径方向の鏡（リングの折り返し）で折り返して、擬似的な陰影（凹凸の法線と鏡面光）を付ける全画面シェーダー。
// 2 色に絞った色と、中心から外へ暗く落とす減衰で、花びらや宝石のような質感を狙う。「暗い穴」でブラックホール風にもなる。
//
// カメラは使わない（頂点シェーダーが画面全体に直接貼る）。マウス操作も無い。
// 負荷はノイズの評価（ドメインワーピングで fbm を 3 回）。ノイズ4 と同じくらい。
//
// 陰影は dFdx / dFdy（画面上の隣のピクセルとの差）で法線を作る。鏡の継ぎ目では値が飛ぶので、
// そこが花びらの縁のようにくっきり見える（意図した効果）。

import * as THREE from 'three';
import { IMode } from '../core/IMode';
import { NOISE6_PARAMS, clampParams, type ParamValues } from './params';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // カメラに関係なく画面全体
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float u_aspect;
  uniform float u_time;      // ノイズの流れ（積算）
  uniform float u_rot;       // 鏡の回転（ラジアン）
  uniform float u_ringZoom;  // リングの流れ（積算）
  uniform float u_hue;       // 色相（0〜1、時間変化を含む）
  uniform float u_hueShift;
  uniform float u_sat;
  uniform float u_seg;
  uniform float u_ringFreq;
  uniform float u_scale;
  uniform float u_warp;
  uniform float u_relief;
  uniform float u_light;
  uniform float u_spec;
  uniform float u_fade;
  uniform float u_hole;
  uniform float u_holeGlow;
  uniform float u_pix;       // 1 ピクセルの大きさ（uv 単位）
  uniform float u_gain;
  uniform int u_oct;
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
    float value = 0.0; float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      if (i >= u_oct) break;
      value += amplitude * snoise(p);
      p = p * 2.0 + vec2(100.0);
      amplitude *= 0.5;
    }
    return value;
  }

  vec3 hue2rgb(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= u_aspect;
    float r = max(length(uv), 0.0001);

    // 角度の鏡: [0, π/N] に折り返す
    float halfSeg = 3.14159265 / u_seg;
    float a = atan(uv.y, uv.x) + u_rot;
    a = abs(mod(a, 2.0 * halfSeg) - halfSeg);

    // 半径の鏡: 三角波でリング状に折り返す（0 で無効）
    float rm = r;
    if (u_ringFreq > 0.001) {
      rm = abs(fract(r * u_ringFreq - u_ringZoom) - 0.5) * 2.0 / u_ringFreq;
    }

    vec2 p = rm * vec2(cos(a), sin(a)) * u_scale;

    // ドメインワーピングで滑らかな凹凸
    vec2 w = vec2(fbm(p + u_time * 0.2), fbm(p + vec2(5.2, 1.3) - u_time * 0.15));
    float h = fbm(p + w * u_warp);
    float v = clamp(h * 0.9 + 0.5, 0.0, 1.0);

    // 色: 暗い色 → 色 A → 色 B（色 B は色相をずらす）
    vec3 colA = mix(vec3(0.55), hue2rgb(u_hue), u_sat);
    vec3 colB = mix(vec3(0.75), hue2rgb(u_hue + u_hueShift), u_sat);
    vec3 dark = colA * 0.06;
    vec3 col = mix(dark, colA, smoothstep(0.15, 0.55, v));
    col = mix(col, colB, smoothstep(0.5, 0.9, v));

    // 擬似的な陰影（画面上の隣のピクセルとの差から法線を作る）
    float k = u_relief / max(u_pix, 1e-5);
    vec3 n = normalize(vec3(-dFdx(h) * k * 0.02, -dFdy(h) * k * 0.02, 1.0));
    vec3 L = normalize(vec3(-0.4, 0.5, 0.8));
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * u_spec;
    col = col * (0.3 + u_light * diff) + spec * colB;

    // 外側ほど暗く
    col *= mix(1.0, smoothstep(1.5, 0.25, r), u_fade);

    // 暗い穴と、縁の光
    if (u_hole > 0.0) {
      col *= smoothstep(u_hole, u_hole * 1.5 + 0.001, r);
      float ring = exp(-abs(r - u_hole * 1.2) * 14.0 / max(u_hole, 0.05));
      col += hue2rgb(u_hue + u_hueShift) * ring * u_holeGlow;
    }

    gl_FragColor = vec4(col * u_gain, 1.0);
  }
`;

export class NoiseMode6 implements IMode {
  private scene!: THREE.Scene;
  private renderer: THREE.WebGLRenderer | null = null;

  private p: ParamValues = clampParams(NOISE6_PARAMS, undefined);
  private brightness = 100;
  // 速さをその場で変えても飛ばないよう、時間ではなく積算で持つ
  private flow = 0;
  private rot = 0;
  private ringZoom = 0;
  private huePhase = 0;

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
    this.p = clampParams(NOISE6_PARAMS, values);
    this.applyParams();
  }

  private applyParams() {
    if (!this.mat) return;
    const p = this.p;
    const u = this.mat.uniforms;
    u.u_seg.value = Math.round(p.segments);
    u.u_ringFreq.value = p.rings;
    u.u_scale.value = p.scale;
    u.u_warp.value = p.warp;
    u.u_oct.value = Math.round(p.detail);
    u.u_relief.value = p.relief;
    u.u_light.value = p.light;
    u.u_spec.value = p.specular;
    u.u_fade.value = p.fade;
    u.u_hole.value = p.hole;
    u.u_holeGlow.value = p.holeGlow;
    u.u_hueShift.value = p.hueShift / 360;
    u.u_sat.value = p.saturation;
    u.u_hue.value = p.hue / 360 + this.huePhase;
  }

  init(scene: THREE.Scene, _camera: THREE.PerspectiveCamera, renderer?: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer ?? null;
    scene.background = new THREE.Color(0x000000);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        u_aspect: { value: window.innerWidth / window.innerHeight },
        u_time: { value: 0 },
        u_rot: { value: 0 },
        u_ringZoom: { value: 0 },
        u_hue: { value: 0 },
        u_hueShift: { value: 0 },
        u_sat: { value: 1 },
        u_seg: { value: 8 },
        u_ringFreq: { value: 0 },
        u_scale: { value: 1 },
        u_warp: { value: 1 },
        u_relief: { value: 1 },
        u_light: { value: 1 },
        u_spec: { value: 0.5 },
        u_fade: { value: 0.8 },
        u_hole: { value: 0 },
        u_holeGlow: { value: 0 },
        u_pix: { value: 0.002 },
        u_gain: { value: this.gain() },
        u_oct: { value: 4 },
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
    this.applyParams();
    this.onResize();
  }

  onResize() {
    if (!this.mat) return;
    this.mat.uniforms.u_aspect.value = window.innerWidth / window.innerHeight;
    // 1 ピクセルの大きさ（uv 単位）。描画の解像度の倍率が変わっても、陰影の強さが変わらないようにする
    const h = this.renderer ? this.renderer.getDrawingBufferSize(new THREE.Vector2()).y : window.innerHeight;
    this.mat.uniforms.u_pix.value = 2 / Math.max(h, 1);
  }

  update(delta: number, _time: number) {
    if (!this.mat) return;
    const p = this.p;
    this.flow += delta * p.speed;
    this.rot += delta * p.rotation;
    this.ringZoom += delta * p.ringFlow;
    if (p.colorCycle > 0) this.huePhase = (this.huePhase + delta / p.colorCycle) % 1;
    const u = this.mat.uniforms;
    u.u_time.value = this.flow;
    u.u_rot.value = this.rot;
    u.u_ringZoom.value = this.ringZoom;
    u.u_hue.value = p.hue / 360 + this.huePhase;
  }

  dispose() {
    if (this.mesh) this.scene.remove(this.mesh);
    this.geo?.dispose();
    this.mat?.dispose();
    this.mesh = null;
    this.geo = null;
    this.mat = null;
    this.renderer = null;
    this.scene.background = null;
  }
}

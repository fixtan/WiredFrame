// src/modes/NoiseMode5.ts
//
// 魔法陣のルーン（3D ボロノイの境界線を、円柱に巻き付けて同心円状に並べた全画面シェーダー）。
// 元ネタ: [Noise #55] Procedural Alien Runes。元は音と関係なく、時間だけで動く。
//
// カメラは使わない（頂点シェーダーが画面全体に直接貼る）。マウス操作も無い。
// 負荷はピクセル数に比例し、色収差（R/G/B をずらして 3 回ボロノイを引く）が大半を占める。
// 重い場合は、描画の解像度を下げるか、色収差を 0（1 回だけ引く）にする。

import * as THREE from 'three';
import { IMode } from '../core/IMode';
import { NOISE5_PARAMS, clampParams, type ParamValues } from './params';

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
  uniform float u_scale;
  uniform float u_thickness;
  uniform float u_glow;
  uniform float u_polarMix;
  uniform float u_fbmAmount;
  uniform float u_ringFreq;
  uniform float u_ca;       // 色収差のずれ（0 なら 1 回だけ引く）
  uniform float u_gain;
  uniform vec3 u_colorCore;
  uniform vec3 u_colorGlow;
  varying vec2 vUv;

  // 2D Random (FBM 用)
  vec2 random2(vec2 p) {
    return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
  }

  // 3D Random (3D Voronoi 用)
  vec3 random3(vec3 p) {
    return fract(sin(vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    )) * 43758.5453);
  }

  // 2D Value Noise
  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec2 u = f*f*(3.0-2.0*f);
    return mix( mix( dot( random2(i + vec2(0.0,0.0)), f - vec2(0.0,0.0) ),
                     dot( random2(i + vec2(1.0,0.0)), f - vec2(1.0,0.0) ), u.x),
                mix( dot( random2(i + vec2(0.0,1.0)), f - vec2(0.0,1.0) ),
                     dot( random2(i + vec2(1.0,1.0)), f - vec2(1.0,1.0) ), u.x), u.y);
  }

  float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(st * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  // 3D Voronoi / Worley Noise (F1 & F2)。次元を上げて、切れ目のない空間のねじれを許容する
  vec2 voronoi3D(vec3 x) {
    vec3 n = floor(x);
    vec3 f = fract(x);
    float F1 = 8.0;
    float F2 = 8.0;
    for (int k=-1; k<=1; k++) {
      for (int j=-1; j<=1; j++) {
        for (int i=-1; i<=1; i++) {
          vec3 g = vec3(float(i), float(j), float(k));
          vec3 o = random3(n + g);
          // 生きた文字のように母点をゆっくり動かす
          o = 0.5 + 0.5 * sin(u_time * 0.5 + 6.2831 * o);
          vec3 r = g + o - f;
          float d = dot(r, r);
          if (d < F1) {
            F2 = F1;
            F1 = d;
          } else if (d < F2) {
            F2 = d;
          }
        }
      }
    }
    return vec2(sqrt(F1), sqrt(F2));
  }

  // 魔法文字（ルーン）を削り出すメインロジック（3D 投影版）
  float getRunePattern(vec2 uv, vec3 offset) {
    float r = max(length(uv), 0.0001);

    // 直交座標の 3D マッピング（Z は 0）
    vec3 cartesianP = vec3(uv.x * u_scale, uv.y * u_scale, 0.0);

    // 極座標の 3D シリンダー（円柱）マッピング。atan を使わず cos / sin で巻き付けるので、角度のジャンプ（切れ目）が出ない
    float cylRadius = u_scale / 6.28318530718;
    vec3 polarP = vec3(
      cylRadius * (uv.x / r),
      cylRadius * (uv.y / r),
      r * u_scale
    );

    vec3 warpedP = mix(cartesianP, polarP, u_polarMix);
    vec2 v = voronoi3D(warpedP + offset);
    return v.y - v.x; // F2 - F1 でエッジ（境界線）の距離場
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= u_aspect;

    // 空間全体の揺らぎ
    float spaceJitter = fbm(uv * 2.0 - u_time * 0.2) * 0.1;
    vec2 baseUV = uv + spaceJitter;

    // FBM による「浸食（かすれ）」マスク
    float mask = fbm(baseUV * 3.0 + u_time * 0.1);
    float erode = smoothstep(u_fbmAmount - 0.2, u_fbmAmount + 0.2, mask + 0.5);

    // 同心円による分断（リング状の階層構造）
    float radius = length(baseUV);
    float rings = sin(radius * u_ringFreq - u_time);
    float ringMask = smoothstep(-0.2, 0.2, rings);

    // エッジ抽出と色収差
    float edgeR = getRunePattern(baseUV, vec3(0.0));
    float edgeG = edgeR;
    float edgeB = edgeR;
    if (u_ca > 0.0) {
      edgeG = getRunePattern(baseUV, vec3(u_ca));
      edgeB = getRunePattern(baseUV, vec3(u_ca * 2.0));
    }

    // 芯となる鋭い線
    vec3 core = vec3(
      1.0 - smoothstep(0.0, u_thickness, edgeR),
      1.0 - smoothstep(0.0, u_thickness, edgeG),
      1.0 - smoothstep(0.0, u_thickness, edgeB)
    );

    // 周囲に滲む発光
    vec3 glowBase = vec3(
      1.0 - smoothstep(0.0, u_glow, edgeR),
      1.0 - smoothstep(0.0, u_glow, edgeG),
      1.0 - smoothstep(0.0, u_glow, edgeB)
    );

    vec3 finalCore = core * u_colorCore * erode * ringMask;
    vec3 finalGlow = glowBase * u_colorGlow * erode * ringMask;

    // 暗闇の背景色（中心部はわずかに明るく）
    vec3 bgColor = vec3(0.02, 0.03, 0.05) * (1.0 - radius * 0.5);

    vec3 color = bgColor + finalCore + finalGlow;

    // ビネット（四隅を暗くする）
    color *= 1.0 - smoothstep(0.5, 1.5, radius);

    gl_FragColor = vec4(color * u_gain, 1.0);
  }
`;

export class NoiseMode5 implements IMode {
  private scene!: THREE.Scene;

  private p: ParamValues = clampParams(NOISE5_PARAMS, undefined);
  private brightness = 100;
  // 速さ・色の速さをその場で変えても飛ばないよう、時間ではなく積算で持つ
  private flow = 0;
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
    this.p = clampParams(NOISE5_PARAMS, values);
    this.applyParams();
  }

  private applyParams() {
    if (!this.mat) return;
    const p = this.p;
    const u = this.mat.uniforms;
    u.u_scale.value = p.scale;
    u.u_thickness.value = p.thickness;
    u.u_glow.value = p.glow;
    u.u_polarMix.value = p.polar;
    u.u_fbmAmount.value = p.erosion;
    u.u_ringFreq.value = p.rings;
    u.u_ca.value = p.aberration;
    this.applyColors();
  }

  /** 色。元の色（#00ffcc / #ffffff）は sRGB の文字列を linear にして出力していたので、HSL も sRGB として解釈して合わせる */
  private applyColors() {
    if (!this.mat) return;
    const p = this.p;
    const u = this.mat.uniforms;
    const hue = (((p.hue + this.huePhase * 360) % 360) + 360) % 360;
    const glow = u.u_colorGlow.value as THREE.Color;
    glow.setHSL(hue / 360, p.saturation, p.glowLight, THREE.SRGBColorSpace);
    // 芯は白から、発光色の方へ寄せられる
    (u.u_colorCore.value as THREE.Color).set(0xffffff).lerp(glow, p.coreTint);
  }

  init(scene: THREE.Scene, _camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    scene.background = new THREE.Color(0x000000);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        u_time: { value: 0 },
        u_aspect: { value: window.innerWidth / window.innerHeight },
        u_scale: { value: 20 },
        u_thickness: { value: 0.04 },
        u_glow: { value: 0.35 },
        u_polarMix: { value: 1 },
        u_fbmAmount: { value: 0.3 },
        u_ringFreq: { value: 20 },
        u_ca: { value: 0.02 },
        u_gain: { value: this.gain() },
        u_colorCore: { value: new THREE.Color() },
        u_colorGlow: { value: new THREE.Color() },
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
  }

  onResize() {
    if (this.mat) this.mat.uniforms.u_aspect.value = window.innerWidth / window.innerHeight;
  }

  update(delta: number, _time: number) {
    if (!this.mat) return;
    const p = this.p;
    this.flow += delta * p.speed;
    this.mat.uniforms.u_time.value = this.flow;
    if (p.colorCycle > 0) {
      this.huePhase = (this.huePhase + delta / p.colorCycle) % 1;
      this.applyColors();
    }
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

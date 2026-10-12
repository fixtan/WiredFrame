// src/modes/NoiseMode3.ts
//
// ワイヤーフレームの地形（fbm ノイズで頂点を持ち上げ、高さで色分け）。元ネタ: [Noise #57] Audio-Reactive Domain Warping。
// 音との連動・VR は外した。音が無いと起伏が緩やかになるので、高さ・細部・うねりを調整できるようにしてある。
//
// 負荷は頂点数（分割数²）に比例する。範囲を広げると同じ密度なら頂点が増えるので、
// 分割数を保ったまま広げて粗くするか、霧（遠くを黒へ溶かす）で端を隠す。調整は params.ts の NOISE3_PARAMS。

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IMode } from '../core/IMode';
import { NOISE3_PARAMS, clampParams, type ParamValues } from './params';

// 元の地形は一辺 18 を 2.0 のノイズ倍率で作っていた。ノイズは「ワールドの位置」で引くので、範囲を変えても山の大きさは変わらない
const ORIG_HALF = 9;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uNoiseScale;
  uniform float uHeight;
  uniform float uAmp;     // うねり（時間でゆっくり増減する倍率）
  uniform float uGainOct; // 細部の強さ（オクターブごとの振幅の比）
  uniform int uOct;
  varying float vElevation;
  varying float vDist;

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
      if (i >= uOct) break;
      value += amplitude * snoise(p * frequency);
      p = p * 2.0 + vec2(100.0);
      amplitude *= uGainOct;
    }
    return value;
  }

  void main() {
    vec2 p = position.xy * uNoiseScale;
    float e = fbm(p + uTime * 0.2);
    vElevation = e;

    vec3 pos = position;
    pos.z += e * 0.6 * uHeight * uAmp;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform float uMix;
  uniform float uContrast;
  uniform float uFog;
  uniform float uGain;
  varying float vElevation;
  varying float vDist;

  void main() {
    float n = vElevation * 0.5 + 0.5;
    float t = clamp((n - 0.5) * uContrast + 0.5, 0.0, 1.0) * uMix;
    vec3 color = mix(uLow, uHigh, t) * uGain;
    if (uFog > 0.0) color *= 1.0 - smoothstep(uFog * 0.4, uFog, vDist);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class NoiseMode3 implements IMode {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  private p: ParamValues = clampParams(NOISE3_PARAMS, undefined);
  private brightness = 100;
  private controls: OrbitControls | null = null;
  private appliedDistance = 0;
  // 速さをその場で変えても飛ばないよう、時間ではなく積算で持つ
  private flow = 0;
  private spinAngle = 0;

  private geo: THREE.PlaneGeometry | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private geoKey = '';

  private gain(): number {
    return Math.pow(this.brightness / 100, 2.2);
  }

  setBrightness(percent: number) {
    this.brightness = percent;
    if (this.mat) this.mat.uniforms.uGain.value = this.gain();
  }

  setParams(values: ParamValues) {
    this.p = clampParams(NOISE3_PARAMS, values);
    this.applyParams();
  }

  private applyParams() {
    if (!this.mat) return;
    const p = this.p;
    const u = this.mat.uniforms;
    u.uNoiseScale.value = p.noiseScale / ORIG_HALF;
    u.uHeight.value = p.height;
    u.uGainOct.value = p.roughness;
    u.uOct.value = Math.round(p.detail);
    u.uMix.value = p.colorMix;
    u.uContrast.value = p.colorContrast;
    u.uFog.value = p.fog;
    // 元の色は sRGB の文字列（#2c58af など）を linear にして出力していた。HSL も sRGB として解釈して合わせる
    (u.uLow.value as THREE.Color).setHSL(p.lowHue / 360, p.saturation, p.lowLight, THREE.SRGBColorSpace);
    (u.uHigh.value as THREE.Color).setHSL(p.highHue / 360, p.saturation, p.highLight, THREE.SRGBColorSpace);
    this.rebuildGeometry();
    this.applyCamera();
  }

  /** 範囲か分割数が変わったときだけ作り直す */
  private rebuildGeometry() {
    if (!this.mesh) return;
    const size = this.p.size;
    const seg = Math.round(this.p.segments);
    const key = `${size}:${seg}`;
    if (key === this.geoKey) return;
    this.geoKey = key;
    const old = this.geo;
    this.geo = new THREE.PlaneGeometry(size, size, seg, seg);
    this.mesh.geometry = this.geo;
    old?.dispose();
  }

  /** カメラの距離（スライダーを動かしたときだけ。マウスのホイールで変えた距離は保つ） */
  private applyCamera() {
    if (!this.controls) return;
    if (this.p.distance !== this.appliedDistance) {
      this.appliedDistance = this.p.distance;
      this.camera.position.setLength(this.p.distance);
    }
  }

  init(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer?: THREE.WebGLRenderer) {
    if (!renderer) throw new Error('NoiseMode3: renderer が渡されていない');
    this.scene = scene;
    this.camera = camera;
    scene.background = new THREE.Color(0x000000);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uNoiseScale: { value: 0 },
        uHeight: { value: 1 },
        uAmp: { value: 1 },
        uGainOct: { value: 0.5 },
        uOct: { value: 4 },
        uLow: { value: new THREE.Color() },
        uHigh: { value: new THREE.Color() },
        uMix: { value: 1 },
        uContrast: { value: 1 },
        uFog: { value: 0 },
        uGain: { value: this.gain() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      wireframe: true,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    // 頂点はシェーダーで持ち上がる。バウンディングが元の平面のままでも消えないように
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.applyParams(); // 地形・色・霧を反映（ジオメトリもここで作る）

    // 最初の位置: 元の (0, 2, 4) と同じ見下ろしの角度
    const d = this.p.distance;
    const elev = Math.atan2(2, 4);
    camera.position.set(0, d * Math.sin(elev), d * Math.cos(elev));
    this.appliedDistance = d;
    camera.lookAt(0, 0, 0);

    // マウスで回したり寄ったりできる（地形自体もゆっくり回っている）。地面より下には回り込めない
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.5;
    controls.maxDistance = 100;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls = controls;
  }

  update(delta: number, _time: number) {
    if (!this.mat || !this.mesh) return;
    this.controls?.update(delta);
    // 元は 1 フレームあたり 0.002（60fps で秒間 0.12）
    this.flow += delta * 0.12 * this.p.speed;
    this.spinAngle += delta * this.p.spin;
    this.mesh.rotation.z = this.spinAngle;
    this.mat.uniforms.uTime.value = this.flow;
    this.mat.uniforms.uAmp.value = 1 + this.p.swell * 0.6 * Math.sin(this.flow * 5);
  }

  dispose() {
    this.controls?.dispose();
    this.controls = null;
    if (this.mesh) this.scene.remove(this.mesh);
    this.geo?.dispose();
    this.mat?.dispose();
    this.mesh = null;
    this.geo = null;
    this.mat = null;
    this.geoKey = '';
    this.scene.background = null;
  }
}

// src/modes/NoiseMode2.ts
//
// Mandelbulb × 虹色（レイマーチング）。元ネタ: [Noise #60] Mantra in Mandelbulb。
// 音との連動・グリッチ・VR は外した。形のゆっくりした回転と、降ってくる粒だけを残している。
//
// 負荷は画面の解像度に比例する（全ピクセルでレイを飛ばす）。重い場合は、次を調整する（params.ts）:
//   描画の解像度 / レイのステップ数 / 反復回数 / 光のにじみ（ブルーム）/ 粒の数

// 参考:
//  [Noise #60] Mantra in Mandelbulb
//  https://lain-lab.com/posts/noise-intro-60-audio-visual-art

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { IMode } from '../core/IMode';
import { NOISE2_PARAMS, clampParams, type ParamValues } from './params';

const METEOR_MAX = 2000;

const CORE_FRAGMENT = /* glsl */ `
  uniform float uPhase;
  uniform float uPower;
  uniform float uIriScale;
  uniform float uGain;
  uniform int uSteps;
  uniform int uIter;
  varying vec3 vPos;

  vec3 palette(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
  }

  vec2 map(vec3 p) {
    vec3 w = p;
    float m = dot(w, w);
    float dz = 1.0;
    float power = uPower;
    float trap = 1.0;

    for (int i = 0; i < 8; i++) {
      if (i >= uIter || m > 256.0) break;
      dz = power * pow(m, (power - 1.0) * 0.5) * dz + 1.0;
      float r = length(w);
      float b = power * acos(w.y / r);
      float a = power * atan(w.x, w.z);
      w = p + pow(r, power) * vec3(sin(b) * sin(a), cos(b), sin(b) * cos(a));
      trap = min(trap, length(w));
      m = dot(w, w);
    }
    return vec2(0.25 * log(m) * sqrt(m) / dz, trap);
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.005, 0.0);
    return normalize(vec3(
      map(p + e.xyy).x - map(p - e.xyy).x,
      map(p + e.yxy).x - map(p - e.yxy).x,
      map(p + e.yyx).x - map(p - e.yyx).x
    ));
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vPos - ro);

    float t = 0.0;
    vec2 res = vec2(0.0);
    for (int i = 0; i < 100; i++) {
      if (i >= uSteps) break;
      vec3 p = ro + rd * t;
      res = map(p);
      if (res.x < 0.002 || t > 10.0) break;
      t += res.x;
    }

    if (t > 10.0) discard;

    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);

    float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
    vec3 iriColor = palette(fresnel * uIriScale + res.y * 2.0 + uPhase);

    vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
    float diff = max(dot(n, lightDir), 0.0);

    vec3 glow = iriColor * fresnel;
    vec3 base = iriColor * diff * 0.5;

    gl_FragColor = vec4((base + glow) * uGain, 1.0);
  }
`;

const METEOR_VERTEX = /* glsl */ `
  uniform float uTime;
  attribute vec3 aOffset;
  attribute float aRandom;
  varying float vLight;
  varying float vAlpha;

  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  void main() {
    vec3 pos = position * (0.5 + aRandom * 2.0);
    pos.xy *= rot(uTime * aRandom * 3.0);
    pos.xz *= rot(uTime * aRandom * 3.0);

    vec3 offset = aOffset;
    offset.y -= uTime * (0.5 + aRandom * 2.0);
    offset.y = mod(offset.y + 20.0, 40.0) - 20.0; // 空間をループ

    vec4 mvPosition = modelViewMatrix * vec4(pos + offset, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    vLight = max(dot(normalize(pos), vec3(1.0, 1.0, 1.0)), 0.2);
    vAlpha = smoothstep(30.0, 10.0, length(offset));
  }
`;

const METEOR_FRAGMENT = /* glsl */ `
  uniform float uGain;
  varying float vLight;
  varying float vAlpha;
  void main() {
    vec3 color = vec3(0.05, 0.2, 0.6) * vLight * uGain;
    gl_FragColor = vec4(color, vAlpha);
  }
`;

export class NoiseMode2 implements IMode {
  private scene!: THREE.Scene;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera!: THREE.PerspectiveCamera;

  private p: ParamValues = clampParams(NOISE2_PARAMS, undefined);
  private brightness = 100;
  private controls: OrbitControls | null = null;
  private appliedDistance = 0;
  // 色の速さをその場で変えても飛ばないよう、時間ではなく積算で持つ
  private phase = 0;

  private coreGeo: THREE.BoxGeometry | null = null;
  private coreMat: THREE.ShaderMaterial | null = null;
  private core: THREE.Mesh | null = null;
  private meteorGeo: THREE.InstancedBufferGeometry | null = null;
  private meteorMat: THREE.ShaderMaterial | null = null;
  private meteors: THREE.Mesh | null = null;

  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  private gain(): number {
    return Math.pow(this.brightness / 100, 2.2);
  }

  setBrightness(percent: number) {
    this.brightness = percent;
    const g = this.gain();
    if (this.coreMat) this.coreMat.uniforms.uGain.value = g;
    if (this.meteorMat) this.meteorMat.uniforms.uGain.value = g;
  }

  getRenderScale(): number {
    return this.p.renderScale;
  }

  setParams(values: ParamValues) {
    this.p = clampParams(NOISE2_PARAMS, values);
    if (this.coreMat) {
      const u = this.coreMat.uniforms;
      u.uPower.value = this.p.power;
      u.uIriScale.value = this.p.iri;
      u.uSteps.value = Math.round(this.p.steps);
      u.uIter.value = Math.round(this.p.iterations);
    }
    if (this.meteorGeo) this.meteorGeo.instanceCount = Math.round(this.p.meteors);
    this.updateBloom();
    this.applyCamera();
  }

  /** 自動回転の速さと、カメラの距離（スライダーを動かしたときだけ。マウスのホイールで変えた距離は保つ） */
  private applyCamera() {
    if (!this.controls) return;
    this.controls.autoRotateSpeed = 60 / this.p.orbit; // OrbitControls は 1 のとき 60 秒で一周
    if (this.p.distance !== this.appliedDistance) {
      this.appliedDistance = this.p.distance;
      this.camera.position.setLength(this.p.distance);
    }
  }

  /** ブルームは強さが 0 のときは使わない（ポストエフェクトを丸ごと省いて軽くする） */
  private updateBloom() {
    if (this.bloomPass) this.bloomPass.strength = this.p.bloom;
  }

  init(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer?: THREE.WebGLRenderer) {
    if (!renderer) throw new Error('NoiseMode2: renderer が渡されていない');
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    scene.background = new THREE.Color(0x020205);

    // ---- Mandelbulb（巨大な箱の内側から、全ピクセルでレイを飛ばす） ----
    this.coreGeo = new THREE.BoxGeometry(100, 100, 100);
    this.coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uPhase: { value: 0 },
        uPower: { value: this.p.power },
        uIriScale: { value: this.p.iri },
        uGain: { value: this.gain() },
        uSteps: { value: Math.round(this.p.steps) },
        uIter: { value: Math.round(this.p.iterations) },
      },
      transparent: true,
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: CORE_FRAGMENT,
      side: THREE.DoubleSide,
    });
    this.core = new THREE.Mesh(this.coreGeo, this.coreMat);
    scene.add(this.core);

    // ---- 降ってくる粒 ----
    const base = new THREE.IcosahedronGeometry(0.08, 0);
    const geo = new THREE.InstancedBufferGeometry().copy(base as unknown as THREE.InstancedBufferGeometry);
    base.dispose();
    const offsets = new Float32Array(METEOR_MAX * 3);
    const randoms = new Float32Array(METEOR_MAX);
    for (let i = 0; i < METEOR_MAX; i++) {
      offsets[i * 3 + 0] = (Math.random() - 0.5) * 40;
      offsets[i * 3 + 1] = (Math.random() - 0.5) * 40;
      offsets[i * 3 + 2] = (Math.random() - 0.5) * 40;
      randoms[i] = Math.random();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 1));
    geo.instanceCount = Math.round(this.p.meteors);
    this.meteorGeo = geo;
    this.meteorMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGain: { value: this.gain() } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      vertexShader: METEOR_VERTEX,
      fragmentShader: METEOR_FRAGMENT,
    });
    this.meteors = new THREE.Mesh(geo, this.meteorMat);
    // 頂点位置はシェーダーで決まるので、視錐台カリングで消えないようにする
    this.meteors.frustumCulled = false;
    scene.add(this.meteors);

    // ---- ブルーム（光のにじみ）----
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), this.p.bloom, 0.5, 0.1);
    this.composer.addPass(this.bloomPass);
    this.onResize();

    this.placeCamera();

    // マウスで回したり寄ったりできる。何もしなければ自動で回り続ける
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 50;
    this.controls = controls;
    this.applyCamera();
  }

  /** 最初の位置: 見下ろしの角度は元の (0, 2, 3) と同じ */
  private placeCamera() {
    const d = this.p.distance;
    const elev = Math.atan2(2, 3);
    this.camera.position.set(0, d * Math.sin(elev), d * Math.cos(elev));
    this.appliedDistance = d;
    this.camera.lookAt(0, 0, 0);
  }

  onResize() {
    if (!this.composer || !this.renderer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  update(delta: number, time: number) {
    if (!this.coreMat || !this.meteorMat) return;
    this.controls?.update(delta);
    this.phase = (this.phase + delta * this.p.colorSpeed) % 1000;
    this.coreMat.uniforms.uPhase.value = this.phase;
    this.meteorMat.uniforms.uTime.value = time;
  }

  render(renderer: THREE.WebGLRenderer) {
    if (this.composer && this.p.bloom > 0) this.composer.render();
    else renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.controls?.dispose();
    this.controls = null;
    if (this.core) this.scene.remove(this.core);
    if (this.meteors) this.scene.remove(this.meteors);
    this.coreGeo?.dispose();
    this.coreMat?.dispose();
    this.meteorGeo?.dispose();
    this.meteorMat?.dispose();
    this.bloomPass?.dispose();
    this.composer?.dispose();
    this.renderer = null;
    this.core = this.meteors = null;
    this.coreGeo = null;
    this.coreMat = this.meteorMat = null;
    this.meteorGeo = null;
    this.bloomPass = null;
    this.composer = null;
    this.scene.background = null;
  }
}

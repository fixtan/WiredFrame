// src/modes/NoiseMode1.ts
//
// Curl Noise パーティクル（GPGPU）。粒子の位置を GPU のテクスチャに持ち、
// カールノイズの流れ場で動かす。音との連動は無し：脈動は内部の LFO で代用し、
// 色は時間でゆっくり一周する。
//
// 負荷は「粒子数（size×size）」と「FPS 上限」で決まる。モニターごとに設定できる。

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { IMode } from '../core/IMode';
import { NOISE1_PARAMS, clampParams, type ParamValues } from './params';

// ---- 調整できる値は src/modes/params.ts（NOISE1_PARAMS）。ここは固定の定数 ----
const REF_HEIGHT = 1400; // 粒子サイズの基準にする画面の高さ(px)

const COMPUTE_SHADER = /* glsl */ `
  uniform float u_time;
  uniform float u_dt;
  uniform float u_pulse;
  uniform float u_swirl;
  uniform sampler2D textureBasePosition;

  uniform float u_noiseScale;
  uniform float u_impact;
  uniform float u_lifeSpeed;
  uniform float u_baseSpeed;

  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  float snoise(vec3 v){
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0 );
    vec4 p = permute( permute( permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 1.0/7.0;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    return 42.0 * dot( vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)), vec4(1.0) );
  }
  vec3 snoise3(vec3 x) {
    return vec3( snoise(x), snoise(x+vec3(123.4, 129.1, 315.6)), snoise(x+vec3(-134.5, 231.2, -451.3)) );
  }
  vec3 curlNoise(vec3 p) {
    const float e = 0.1;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    vec3 p_x0 = snoise3(p - dx);
    vec3 p_x1 = snoise3(p + dx);
    vec3 p_y0 = snoise3(p - dy);
    vec3 p_y1 = snoise3(p + dy);
    vec3 p_z0 = snoise3(p - dz);
    vec3 p_z1 = snoise3(p + dz);
    float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
    float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
    float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;
    const float divisor = 1.0 / (2.0 * e);
    return normalize(vec3(x, y, z) * divisor);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 posData = texture2D(texturePosition, uv);
    vec3 pos = posData.xyz;
    float life = posData.w;

    life -= (u_lifeSpeed + u_pulse * 0.015) * u_dt;

    if (life <= 0.0) {
      pos = texture2D(textureBasePosition, uv).xyz;
      life = 1.0;
    } else {
      float freq = u_noiseScale + (u_swirl * 0.2);
      vec3 velocity = curlNoise(pos * freq + u_time * 0.15);
      float speed = u_baseSpeed + (pow(u_pulse, 2.0) * u_impact);
      pos += velocity * speed * u_dt;
    }

    gl_FragColor = vec4(pos, life);
  }
`;

const VERTEX_SHADER = /* glsl */ `
  uniform sampler2D texturePosition;
  uniform float u_flash;
  uniform vec3 u_colorBase;
  uniform vec3 u_colorFlash;
  uniform float u_particleSize;
  uniform float u_pixelScale;
  uniform float u_gain;

  varying vec3 vColor;
  varying float vLife;

  void main() {
    vec4 posData = texture2D(texturePosition, position.xy);
    vec3 pos = posData.xyz;
    vLife = posData.w;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float size = u_particleSize + (pow(u_flash, 2.0) * (u_particleSize * 5.0));
    gl_PointSize = max(1.0, size * u_pixelScale * (1.0 / -mvPosition.z));

    float flashIntensity = smoothstep(0.1, 0.7, u_flash);
    vec3 baseMixedColor = mix(u_colorBase, u_colorFlash, flashIntensity);
    vec3 hotCoreEffect = u_colorFlash * pow(vLife, 3.0);

    vColor = (baseMixedColor + hotCoreEffect) * u_gain;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vLife;

  void main() {
    vec2 uv = gl_PointCoord.xy - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float alpha = smoothstep(0.5, 0.05, dist) * pow(vLife, 0.8);
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export class NoiseMode1 implements IMode {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;

  private size: number;
  private brightness = 100;
  // 周期をその場で変えても色・回転が飛ばないよう、時間ではなく積算で持つ
  private huePhase = 0;
  private controls: OrbitControls | null = null;
  private appliedDistance = 0;
  private p: ParamValues = clampParams(NOISE1_PARAMS, undefined);

  private gpu: GPUComputationRenderer | null = null;
  private posVar: ReturnType<GPUComputationRenderer['addVariable']> | null = null;
  private baseTexture: THREE.DataTexture | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private points: THREE.Points | null = null;

  private colorBase = new THREE.Color();
  private colorFlash = new THREE.Color();

  /** @param size 粒子テクスチャの一辺。粒子数は size×size（256 → 約 6.5 万、512 → 約 26 万）。 */
  constructor(size = 384) {
    this.size = size;
  }

  /** 明るさ（%）。タイルモードと同じ見た目の倍率にする（ガンマ 2.2）。 */
  setBrightness(percent: number) {
    this.brightness = percent;
    if (this.material) this.material.uniforms.u_gain.value = this.gain();
  }

  /** 調整パラメータを反映する（init の前でも後でも呼べる） */
  setParams(values: ParamValues) {
    this.p = clampParams(NOISE1_PARAMS, values);
    const m = this.posVar?.material.uniforms;
    if (m) {
      m.u_noiseScale.value = this.p.swirl;
      m.u_impact.value = this.p.pulse;
      m.u_lifeSpeed.value = this.p.life;
      m.u_baseSpeed.value = this.p.speed;
    }
    if (this.material) this.material.uniforms.u_particleSize.value = this.p.particleSize;
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

  private gain(): number {
    return Math.pow(this.brightness / 100, 2.2);
  }

  init(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer?: THREE.WebGLRenderer) {
    if (!renderer) throw new Error('NoiseMode1: renderer が渡されていない');
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    camera.position.set(0, 0, this.p.distance);
    this.appliedDistance = this.p.distance;
    camera.lookAt(0, 0, 0);

    // マウスで回したり寄ったりできる。何もしなければ自動で回り続ける
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.minDistance = 2;
    controls.maxDistance = 100;
    this.controls = controls;
    this.applyCamera();
    scene.background = new THREE.Color(0x05070a);

    const W = this.size;
    const count = W * W;

    const gpu = new GPUComputationRenderer(W, W, renderer);
    const dtPosition = gpu.createTexture();
    const arr = dtPosition.image.data as Float32Array;
    for (let i = 0; i < arr.length; i += 4) {
      // 球の中に一様にばらまく。w は寿命（最初はバラバラにして一斉に消えないようにする）
      const r = 2.0 * Math.cbrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i + 0] = r * Math.sin(phi) * Math.cos(theta);
      arr[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i + 2] = r * Math.cos(phi);
      arr[i + 3] = Math.random();
    }
    // 寿命が尽きた粒子の戻り先（初期配置のコピー）
    this.baseTexture = dtPosition.clone();
    this.baseTexture.needsUpdate = true;

    const v = gpu.addVariable('texturePosition', COMPUTE_SHADER, dtPosition);
    const u = v.material.uniforms;
    u.u_time = { value: 0 };
    u.u_dt = { value: 1 };
    u.u_pulse = { value: 0 };
    u.u_swirl = { value: 0 };
    u.textureBasePosition = { value: this.baseTexture };
    u.u_noiseScale = { value: this.p.swirl };
    u.u_impact = { value: this.p.pulse };
    u.u_lifeSpeed = { value: this.p.life };
    u.u_baseSpeed = { value: this.p.speed };
    gpu.setVariableDependencies(v, [v]);
    const err = gpu.init();
    if (err !== null) throw new Error(`NoiseMode1: GPGPU の初期化に失敗: ${err}`);
    this.gpu = gpu;
    this.posVar = v;

    // 描画用: 各頂点が「位置テクスチャのどこを読むか」を uv として持つ
    const uvs = new Float32Array(count * 2);
    let p = 0;
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        uvs[p++] = (i + 0.5) / W;
        uvs[p++] = (j + 0.5) / W;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(uvs, 2));
    // 頂点位置はシェーダーで決まるので、視錐台カリングで消えないようにする
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        texturePosition: { value: null },
        u_flash: { value: 0 },
        u_colorBase: { value: this.colorBase },
        u_colorFlash: { value: this.colorFlash },
        u_particleSize: { value: this.p.particleSize },
        u_pixelScale: { value: 1 },
        u_gain: { value: this.gain() },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    scene.add(this.points);

    this.updateColors();
    this.onResize();
  }

  /** 粒子の大きさは画面の高さに合わせる（解像度の違うモニターで見た目を揃える） */
  onResize() {
    if (!this.material || !this.renderer) return;
    const h = this.renderer.domElement.height || REF_HEIGHT;
    this.material.uniforms.u_pixelScale.value = h / REF_HEIGHT;
  }

  /** 色は時間でゆっくり一周する。基本色と、光る芯の色は色相をずらす。 */
  private updateColors() {
    const h = (this.huePhase + 0.62) % 1; // 開始は元の青
    this.colorBase.setHSL(h, 1.0, 0.5);
    this.colorFlash.setHSL((h + 0.2) % 1, 1.0, 0.6);
  }

  update(delta: number, time: number) {
    if (!this.gpu || !this.posVar || !this.material || !this.points) return;

    // 音の代わりの脈動。ゆっくり呼吸して、ときどき大きく膨らむ
    const breath = 0.5 + 0.5 * Math.sin(time * 0.7);
    const surge = Math.pow(Math.max(0, Math.sin(time * 0.23) * Math.sin(time * 0.11 + 1.0)), 2);
    const pulse = 0.04 + 0.06 * breath + 0.22 * surge;
    const swirl = 0.15 + 0.15 * (0.5 + 0.5 * Math.sin(time * 0.17));
    const flash = 0.15 * breath + 0.5 * surge;

    // 60fps を 1 として、FPS 上限で間引かれても動きの速さが変わらないようにする
    const dt = Math.min(delta * 60, 4);

    const u = this.posVar.material.uniforms;
    u.u_time.value = time;
    u.u_dt.value = dt;
    u.u_pulse.value = pulse;
    u.u_swirl.value = swirl;
    this.material.uniforms.u_flash.value = flash;
    this.huePhase = (this.huePhase + delta / this.p.colorCycle) % 1;
    this.updateColors();

    this.gpu.compute();
    this.material.uniforms.texturePosition.value = this.gpu.getCurrentRenderTarget(this.posVar).texture;

    this.controls?.update(delta);
  }

  dispose() {
    this.controls?.dispose();
    this.controls = null;
    if (this.points) this.scene.remove(this.points);
    this.geometry?.dispose();
    this.material?.dispose();
    this.baseTexture?.dispose();
    this.gpu?.dispose();
    this.points = null;
    this.geometry = null;
    this.material = null;
    this.baseTexture = null;
    this.gpu = null;
    this.posVar = null;
    this.scene.background = null;
  }
}

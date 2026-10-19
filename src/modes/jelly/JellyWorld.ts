// src/modes/jelly/JellyWorld.ts
//
// ゼリーの物理（three.js に依存しない。Node でも動く）。
//
// 1 個のゼリー = 点が輪になったもの。PBD（Position Based Dynamics）+ Verlet 積分で、
// 1 フレームを SUB 回に分けて計算する。拘束は「辺の長さ」「面積（圧力）」「1 つ飛ばしの距離」「形の保持」。
// ゼリー同士のぶつかりは、点が相手の多角形の内側に入ったら、いちばん近い辺から押し出す。
//
// 動き（スクリーンセーバー用）:
//   - 重力なし。壁で跳ね返り、全体の速さを一定の範囲に保つ（止まらない）
//   - 同じ段（クラス）のゼリーが重なると合体して 1 段大きくなる（'grow'）
//   - いちばん大きい段ができたら「臨界点」の演出（ev）→ 分裂フェーズ（'split'）
//   - 分裂フェーズでは、ぶつかったゼリーが 1 段小さい 2 個に分かれる。下限の段まで小さくなったら 'grow' に戻る
//
// 座標は「箱の座標」。箱の高さは BOX_H で固定し、幅は画面の縦横比で決める（setBox）。
// 時間は 1/60 秒を 1 フレームとする固定刻み（step()）。

export const BOX_H = 700;

const PT_GAP = 14; // 輪郭の点の間隔（箱の座標）
const N_MIN = 18;
const N_MAX = 110;
const SUB = 6; // 1 フレームを分けるサブステップ数
const DT = 1 / 60;
const INNER = 0.985; // 中の震えを 1 サブステップごとに残す割合
const ROT = 0.35;
const MERGE_PTS = 5; // 何個の点が重なったら合体するか
const WALL_MU = 0.04;
const WALL_E = 0.85;

/** 段（クラス）ごとの基準の半径と色相。半径は sizeScale 倍して使う */
export const CLASSES = [
  { r: 16, h: 8 },
  { r: 22, h: 50 },
  { r: 30, h: 100 },
  { r: 41, h: 150 },
  { r: 56, h: 185 },
  { r: 77, h: 215 },
  { r: 105, h: 255 },
  { r: 144, h: 290 },
  { r: 197, h: 330 },
];
export const TOP = CLASSES.length - 1;

/** 実行中に変えられるパラメータ（単位はコメントのとおり。秒はフレームに直して使う） */
export type JellyParams = {
  soft: number; // やわらかさ 0〜1
  press: number; // ふくらみ（面積の目標）0.5〜1.1
  speed: number; // 速さ（箱の座標 / フレーム）
  fill: number; // 箱を埋める割合（ゼリーの面積の合計）
  sizeScale: number; // ゼリーの大きさの倍率
  amoeba: number; // 形のいびつさ
  mergeDelaySec: number; // 生まれてから合体できるまで
  splitCoolSec: number; // 生まれてから分裂できるまで
  minCls: number; // 分裂で小さくなる下限の段（0 が最小）
  evSec: number; // 臨界点の演出の長さ
  splitCap: number; // 個数の上限
};

export const DEFAULT_PARAMS: JellyParams = {
  soft: 0.92,
  press: 0.9,
  speed: 3.5,
  fill: 0.45,
  sizeScale: 1,
  amoeba: 0.3,
  mergeDelaySec: 1.5,
  splitCoolSec: 0.8,
  minCls: 2,
  evSec: 4,
  splitCap: 150,
};

type Pt = [number, number];

export class Jelly {
  cls: number;
  tr: number; // 目標の半径
  hueTo: number;
  hue: number;
  r: number; // 今の半径（成長中は目標に近づく）
  n: number;
  ph = 0;
  w2 = 0;
  w3 = 0;
  t = 0;
  dead = false;
  age = 0;
  hit = false;
  p: Pt[] = [];
  prev: Pt[] = [];
  q: Pt[] = [];
  bb = [0, 0, 0, 0];
  L0 = 0;
  L2 = 0;
  A0 = 0;

  constructor(x: number, y: number, cls: number, rTarget: number, r0: number, hue0: number | undefined, amoeba: number, rnd: () => number) {
    this.cls = cls;
    this.tr = rTarget;
    this.hueTo = CLASSES[cls].h;
    this.ph = rnd() * 6.28;
    this.w2 = 0.6 + rnd() * 0.8;
    this.w3 = 0.5 + rnd() * 0.8;
    this.n = ptsFor(rTarget);
    this.r = r0;
    this.hue = hue0 === undefined ? this.hueTo : hue0;
    const N = this.n;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const qx = Math.cos(a) * this.r;
      const qy = Math.sin(a) * this.r;
      this.q.push([qx, qy]);
      this.p.push([x + qx, y + qy]);
      this.prev.push([x + qx, y + qy]);
    }
    this.rebuild(this.r, amoeba);
  }

  /** 大きさ（元の形）を作り直す。成長のときに使う。元の形は 2・3 次の波でゆっくりいびつに変わる */
  rebuild(r: number, A: number) {
    this.r = r;
    const N = this.n;
    const t = this.t;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const k = 1 + A * (Math.cos(2 * a + this.ph + t * this.w2 * 0.03) * 0.8 + Math.cos(3 * a - this.ph * 1.7 + t * this.w3 * 0.04) * 0.6);
      this.q[i][0] = Math.cos(a) * r * k;
      this.q[i][1] = Math.sin(a) * r * k;
    }
    this.L0 = 2 * r * Math.sin(Math.PI / N);
    this.L2 = 2 * r * Math.sin((2 * Math.PI) / N);
    this.A0 = Math.PI * r * r * 0.99; // 点を結んだ多角形の面積は、円より少し小さい
  }

  /** 1 サブステップあたりの平均速度 */
  vel(): Pt {
    const N = this.n;
    let x = 0;
    let y = 0;
    for (let i = 0; i < N; i++) {
      x += this.p[i][0] - this.prev[i][0];
      y += this.p[i][1] - this.prev[i][1];
    }
    return [x / N, y / N];
  }

  center(): Pt {
    const N = this.n;
    let x = 0;
    let y = 0;
    for (const p of this.p) {
      x += p[0];
      y += p[1];
    }
    return [x / N, y / N];
  }

  area(): number {
    const N = this.n;
    let a = 0;
    for (let i = 0; i < N; i++) {
      const p = this.p[i];
      const n = this.p[(i + 1) % N];
      a += p[0] * n[1] - n[0] * p[1];
    }
    return a / 2;
  }

  updateBB() {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    for (const p of this.p) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    this.bb[0] = x0;
    this.bb[1] = y0;
    this.bb[2] = x1;
    this.bb[3] = y1;
  }
}

const ptsFor = (r: number) => Math.min(N_MAX, Math.max(N_MIN, Math.round((2 * Math.PI * r) / PT_GAP)));

/** 合体・臨界点・分裂の演出に使う輪 */
export type Ring = { x: number; y: number; r: number; t: number; L?: number; g?: number };
/** 臨界点の演出の状態 */
export type CritEvent = { t: number; j: Jelly };

function inside(poly: Pt[], x: number, y: number): boolean {
  const N = poly.length;
  let c = false;
  for (let i = 0, j = N - 1; i < N; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

export class JellyWorld {
  W = 640;
  H = BOX_H;
  P: JellyParams = { ...DEFAULT_PARAMS };
  jellies: Jelly[] = [];
  fx: Ring[] = [];
  ev: CritEvent | null = null;
  mode: 'grow' | 'split' = 'grow';
  stats = { merges: 0, top: 0, events: 0, splits: 0, cycles: 0 };
  /** 乱数（テストで差し替える） */
  rnd: () => number = Math.random;

  private frame = 0;
  private pending: [Jelly, Jelly][] = [];
  private acc = 0;
  private splitIdle = 0; // 分裂フェーズで、最後に分裂してからのフレーム数
  private k = 1; // 実際に使う大きさの倍率（箱に収まるよう制限済み）

  constructor(W: number, params?: Partial<JellyParams>) {
    this.setBox(W);
    if (params) this.setParams(params);
    this.reset();
  }

  /** 大きさの倍率。いちばん大きい段が箱の短辺の 34% を超えないようにする */
  private calcK(): number {
    const limit = (0.34 * Math.min(this.W, this.H)) / CLASSES[TOP].r;
    return Math.max(0.3, Math.min(this.P.sizeScale, limit));
  }

  private rad(cls: number) {
    return CLASSES[cls].r * this.k;
  }

  /** 箱の幅を変える。作り直す（reset）ので、呼んだ側で必要なら reset を呼ぶこと */
  setBox(W: number) {
    this.W = Math.max(200, W);
    this.k = this.calcK();
  }

  /** パラメータを反映する。大きさが変わったら true（呼んだ側が reset する） */
  setParams(p: Partial<JellyParams>): boolean {
    const before = this.k;
    this.P = { ...this.P, ...p };
    this.k = this.calcK();
    return Math.abs(before - this.k) > 1e-6;
  }

  get scale() {
    return this.k;
  }

  reset() {
    this.jellies = [];
    this.fx = [];
    this.ev = null;
    this.mode = 'grow';
    this.pending = [];
    this.frame = 0;
    this.acc = 0;
    this.splitIdle = 0;
    this.stats = { merges: 0, top: 0, events: 0, splits: 0, cycles: 0 };
    // 最初から、箱の面積の割合 fill の 6 割くらいまで置いておく
    for (let i = 0; i < 40 && this.totalArea() < this.P.fill * 0.6 * this.W * this.H; i++) this.spawnOne();
  }

  private spawn(x: number, y: number, cls: number, rTarget: number, r0: number, hue?: number) {
    const j = new Jelly(x, y, cls, rTarget, r0, hue, this.P.amoeba, this.rnd);
    this.jellies.push(j);
    return j;
  }

  private setVel(j: Jelly, vx: number, vy: number) {
    for (let i = 0; i < j.n; i++) {
      j.prev[i][0] = j.p[i][0] - vx;
      j.prev[i][1] = j.p[i][1] - vy;
    }
  }

  totalArea() {
    return this.jellies.reduce((a, j) => a + Math.PI * j.r * j.r, 0);
  }

  /** 経過時間（秒）ぶん、固定刻みで進める。物理を進めたら true（描画し直す合図） */
  advance(deltaSec: number): boolean {
    this.acc += Math.min(0.1, deltaSec);
    let n = 0;
    while (this.acc >= DT && n < 3) {
      this.step();
      this.acc -= DT;
      n++;
    }
    if (this.acc > DT * 3) this.acc = 0;
    return n > 0;
  }

  // ===== 物理 =====
  private pushOut(A: Jelly, B: Jelly, mu: number): number {
    const N = B.n;
    const NA = A.n;
    let cnt = 0;
    for (let i = 0; i < NA; i++) {
      const p = A.p[i];
      if (p[0] < B.bb[0] || p[0] > B.bb[2] || p[1] < B.bb[1] || p[1] > B.bb[3]) continue;
      if (!inside(B.p, p[0], p[1])) continue;
      cnt++;
      let best = 1e18;
      let bj = 0;
      let bt = 0;
      let bqx = 0;
      let bqy = 0;
      for (let j = 0; j < N; j++) {
        const a = B.p[j];
        const b = B.p[(j + 1) % N];
        const ex = b[0] - a[0];
        const ey = b[1] - a[1];
        const l2 = ex * ex + ey * ey || 1e-9;
        let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a[0] + ex * t;
        const qy = a[1] + ey * t;
        const d = (p[0] - qx) ** 2 + (p[1] - qy) ** 2;
        if (d < best) {
          best = d;
          bj = j;
          bt = t;
          bqx = qx;
          bqy = qy;
        }
      }
      let nx = bqx - p[0];
      let ny = bqy - p[1];
      const pen = Math.hypot(nx, ny);
      if (pen < 1e-6) continue;
      nx /= pen;
      ny /= pen; // p から表面へ向かう向き（B の外向き）
      const e1 = B.p[bj];
      const e2 = B.p[(bj + 1) % N];
      const w1 = 1 - bt;
      const w2 = bt;
      const ws = w1 * w1 + w2 * w2;
      const dp = pen * (ws / (1 + ws));
      const de = pen / (1 + ws); // 質量が同じとして、動かす量を分ける
      p[0] += nx * dp;
      p[1] += ny * dp;
      const k1 = (de * w1) / ws;
      const k2 = (de * w2) / ws;
      e1[0] -= nx * k1;
      e1[1] -= ny * k1;
      e2[0] -= nx * k2;
      e2[1] -= ny * k2;
      // 摩擦: 点の、面に沿った速さを減らす
      const pv = A.prev[i];
      const vx = p[0] - pv[0];
      const vy = p[1] - pv[1];
      const vn = vx * nx + vy * ny;
      pv[0] += (vx - nx * vn) * mu;
      pv[1] += (vy - ny * vn) * mu;
    }
    return cnt;
  }

  private solveJelly(j: Jelly, h: number) {
    const N = j.n;
    const soft = Math.min(1, Math.max(0, this.P.soft));
    const press = Math.min(1.1, Math.max(0.5, this.P.press));
    const perim = 1.02 * Math.sqrt(press);
    const kEdge = 0.3;
    const kShape = (0.0001 + (1 - soft) * (1 - soft) * 0.22) * 0.2; // やわらかいほど、形を戻す力が弱い
    const alpha = (0.00002 + soft * 0.0012) / (h * h);
    // 1) 辺の長さ
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < N; i++) {
        const a = j.p[i];
        const b = j.p[(i + 1) % N];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1e-9;
        const f = ((l - j.L0 * perim) / l) * 0.5 * kEdge;
        dx *= f;
        dy *= f;
        a[0] += dx;
        a[1] += dy;
        b[0] -= dx;
        b[1] -= dy;
      }
    }
    // 2) 面積（圧力）: 中の体積を、目標に近づける
    const A = j.area();
    const target = j.A0 * press;
    const C = A - target;
    let sg = 0;
    const gx = new Array<number>(N);
    const gy = new Array<number>(N);
    for (let i = 0; i < N; i++) {
      const pm = j.p[(i + N - 1) % N];
      const pn = j.p[(i + 1) % N];
      gx[i] = 0.5 * (pn[1] - pm[1]);
      gy[i] = -0.5 * (pn[0] - pm[0]);
      sg += gx[i] * gx[i] + gy[i] * gy[i];
    }
    const lam = -C / (sg + alpha);
    for (let i = 0; i < N; i++) {
      j.p[i][0] += lam * gx[i];
      j.p[i][1] += lam * gy[i];
    }
    // 2.5) ふちのギザギザをならす（1 つ飛ばしの点との距離を保って、折れ曲がりを防ぐ）
    const kB = 0.6;
    const L2 = j.L2;
    for (let i = 0; i < N; i++) {
      const a = j.p[i];
      const b = j.p[(i + 2) % N];
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1e-9;
      const f = ((l - L2 * perim) / l) * 0.5 * kB;
      dx *= f;
      dy *= f;
      a[0] += dx;
      a[1] += dy;
      b[0] -= dx;
      b[1] -= dy;
    }
    // 3) 形をたもつ力（弱い）: 回転も考えて、もとの形へ引き戻す
    const [cx, cy] = j.center();
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < N; i++) {
      const rx = j.p[i][0] - cx;
      const ry = j.p[i][1] - cy;
      const q = j.q[i];
      sx += q[0] * rx + q[1] * ry;
      sy += q[0] * ry - q[1] * rx;
    }
    const th = Math.atan2(sy, sx);
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    for (let i = 0; i < N; i++) {
      const q = j.q[i];
      const gxp = cx + cs * q[0] - sn * q[1];
      const gyp = cy + sn * q[0] + cs * q[1];
      j.p[i][0] += (gxp - j.p[i][0]) * kShape;
      j.p[i][1] += (gyp - j.p[i][1]) * kShape;
    }
  }

  private walls(j: Jelly) {
    const { W, H } = this;
    for (let i = 0; i < j.n; i++) {
      const p = j.p[i];
      const pv = j.prev[i];
      if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) j.hit = true;
      if (p[1] > H) {
        const v = p[1] - pv[1];
        p[1] = H;
        pv[1] = H + Math.max(0, v) * WALL_E;
        pv[0] += (p[0] - pv[0]) * WALL_MU;
      }
      if (p[1] < 0) {
        const v = p[1] - pv[1];
        p[1] = 0;
        pv[1] = Math.min(0, v) * WALL_E;
        pv[0] += (p[0] - pv[0]) * WALL_MU;
      }
      if (p[0] < 0) {
        const v = p[0] - pv[0];
        p[0] = 0;
        pv[0] = Math.min(0, v) * WALL_E;
        pv[1] += (p[1] - pv[1]) * WALL_MU;
      }
      if (p[0] > W) {
        const v = p[0] - pv[0];
        p[0] = W;
        pv[0] = W + Math.max(0, v) * WALL_E;
        pv[1] += (p[1] - pv[1]) * WALL_MU;
      }
    }
  }

  /** 2 つのゼリーを、中心どうしの向きに、重なった分だけ離す（からまって離れなくなるのを防ぐ） */
  private separate(A: Jelly, B: Jelly, ov: number) {
    const ca = A.center();
    const cb = B.center();
    let dx = ca[0] - cb[0];
    let dy = ca[1] - cb[1];
    const d = Math.hypot(dx, dy) || 1e-6;
    dx /= d;
    dy /= d;
    const ma = A.n * A.r;
    const mb = B.n * B.r;
    const step = Math.min(3, 0.4 * ov);
    const sa = (step * mb) / (ma + mb);
    const sb = (step * ma) / (ma + mb);
    const va = A.vel();
    const vb = B.vel();
    const vn = (va[0] - vb[0]) * dx + (va[1] - vb[1]) * dy; // 近づいていたら、はね返す
    if (vn < 0) {
      const J = (-(1 + 0.7) * vn) / (1 / ma + 1 / mb);
      const ua = J / ma;
      const ub = J / mb;
      for (let i = 0; i < A.n; i++) {
        A.prev[i][0] -= dx * ua;
        A.prev[i][1] -= dy * ua;
      }
      for (let i = 0; i < B.n; i++) {
        B.prev[i][0] += dx * ub;
        B.prev[i][1] += dy * ub;
      }
    }
    for (let i = 0; i < A.n; i++) {
      A.p[i][0] += dx * sa;
      A.p[i][1] += dy * sa;
      A.prev[i][0] += dx * sa;
      A.prev[i][1] += dy * sa;
    }
    for (let i = 0; i < B.n; i++) {
      B.p[i][0] -= dx * sb;
      B.p[i][1] -= dy * sb;
      B.prev[i][0] -= dx * sb;
      B.prev[i][1] -= dy * sb;
    }
  }

  private stepSub(h: number) {
    const damp = 0.9985;
    const jellies = this.jellies;
    const mergeDelay = this.P.mergeDelaySec * 60;
    for (const j of jellies) {
      const N = j.n;
      let cvx = 0;
      let cvy = 0;
      let ccx = 0;
      let ccy = 0;
      for (let i = 0; i < N; i++) {
        cvx += j.p[i][0] - j.prev[i][0];
        cvy += j.p[i][1] - j.prev[i][1];
        ccx += j.p[i][0];
        ccy += j.p[i][1];
      }
      cvx /= N;
      cvy /= N;
      ccx /= N;
      ccy /= N;
      let wn = 0;
      let wd = 1e-9; // ぐるぐる回る速さ（角速度）を求めて、少し減らす
      for (let i = 0; i < N; i++) {
        const rx = j.p[i][0] - ccx;
        const ry = j.p[i][1] - ccy;
        const ux = j.p[i][0] - j.prev[i][0] - cvx;
        const uy = j.p[i][1] - j.prev[i][1] - cvy;
        wn += rx * uy - ry * ux;
        wd += rx * rx + ry * ry;
      }
      const om = (wn / wd) * ROT;
      for (let i = 0; i < N; i++) {
        const p = j.p[i];
        const pv = j.prev[i];
        // 全体の動きはそのまま、ゼリーの中の震え（全体の速さからの差）だけを少し減らす
        const ux = p[0] - pv[0] - cvx + (p[1] - ccy) * om;
        const uy = p[1] - pv[1] - cvy - (p[0] - ccx) * om;
        const vx = (cvx + ux * INNER) * damp;
        const vy = (cvy + uy * INNER) * damp;
        pv[0] = p[0];
        pv[1] = p[1];
        p[0] += vx;
        p[1] += vy;
      }
    }
    for (let it = 0; it < 2; it++) {
      for (const j of jellies) this.solveJelly(j, h);
      for (const j of jellies) j.updateBB();
      for (let a = 0; a < jellies.length; a++) {
        for (let b = a + 1; b < jellies.length; b++) {
          const A = jellies[a];
          const B = jellies[b];
          if (A.bb[2] < B.bb[0] || B.bb[2] < A.bb[0] || A.bb[3] < B.bb[1] || B.bb[3] < A.bb[1]) continue;
          if (this.mode === 'grow' && A.cls === B.cls && A.cls < TOP && A.age > mergeDelay && B.age > mergeDelay && !A.dead && !B.dead) {
            // 同じ段: 重なったら合体
            let n = 0;
            for (let i = 0; i < A.n && n < MERGE_PTS; i++) if (inside(B.p, A.p[i][0], A.p[i][1])) n++;
            for (let i = 0; i < B.n && n < MERGE_PTS; i++) if (inside(A.p, B.p[i][0], B.p[i][1])) n++;
            if (n >= MERGE_PTS) {
              this.pending.push([A, B]);
              A.dead = B.dead = true;
            }
            continue;
          }
          const ov = this.pushOut(A, B, 0.12) + this.pushOut(B, A, 0.12);
          if (ov >= 2) {
            A.hit = true;
            B.hit = true;
          }
          if (ov >= 3) this.separate(A, B, ov);
        }
      }
      for (const j of jellies) this.walls(j);
    }
  }

  private mergePair(A: Jelly, B: Jelly) {
    const { W, H } = this;
    const aA = Math.abs(A.area());
    const aB = Math.abs(B.area());
    const ta = aA + aB;
    const ca = A.center();
    const cb = B.center();
    const va = A.vel();
    const vb = B.vel();
    const x = (ca[0] * aA + cb[0] * aB) / ta;
    const y = (ca[1] * aA + cb[1] * aB) / ta;
    const vx = (va[0] * aA + vb[0] * aB) / ta;
    const vy = (va[1] * aA + vb[1] * aB) / ta;
    this.stats.merges++;
    this.fx.push({ x, y, r: A.r, t: 0 });
    const next = A.cls + 1;
    const mg = Math.max(40 * this.k, this.rad(next) * 0.85); // できる場所を壁から離す（壁で潰れて輪郭がねじれるのを防ぐ）
    const j = this.spawn(
      Math.min(W - mg, Math.max(mg, x)),
      Math.min(H - mg, Math.max(mg, y)),
      next,
      this.rad(next),
      A.r * 1.15,
      A.hue,
    );
    if (next === TOP) {
      this.ev = { t: 0, j }; // 臨界点: いちばん大きいゼリーができた
      this.stats.events++;
    }
    const ph = this.rnd() * 6.28;
    const N = j.n; // できた直後は、ぷるんと歪ませる
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 6.28;
      const k = 1 + 0.35 * Math.cos(2 * a + ph);
      j.p[i][0] = x + (j.p[i][0] - x) * k;
      j.p[i][1] = y + (j.p[i][1] - y) * k;
    }
    this.setVel(j, vx, vy);
  }

  /** 止まらないように、全体の速さを一定の範囲に保つ */
  private regulate() {
    const lo = this.P.speed * 0.7;
    const hi = this.P.speed * 1.5;
    for (const j of this.jellies) {
      const N = j.n;
      const v = j.vel();
      const sp = Math.hypot(v[0], v[1]) * SUB;
      let want = 0;
      if (sp < lo) want = lo;
      else if (sp > hi) want = hi;
      else continue;
      if (sp < 0.02) {
        const a = this.rnd() * 6.28;
        for (let i = 0; i < N; i++) {
          j.prev[i][0] -= (Math.cos(a) * lo) / SUB;
          j.prev[i][1] -= (Math.sin(a) * lo) / SUB;
        }
        continue;
      }
      const s = 1 + (want / sp - 1) * 0.12;
      for (let i = 0; i < N; i++) {
        j.prev[i][0] += (1 - s) * v[0];
        j.prev[i][1] += (1 - s) * v[1];
      }
    }
  }

  /** 小さいゼリーを 1 個足す（置ける場所が見つからなければ false） */
  spawnOne(): boolean {
    const { W, H } = this;
    const cls = [0, 0, 0, 1, 1, 2][Math.floor(this.rnd() * 6)];
    const r = this.rad(cls);
    for (let t = 0; t < 12; t++) {
      const x = r + 20 + this.rnd() * Math.max(1, W - 2 * r - 40);
      const y = r + 20 + this.rnd() * Math.max(1, H - 2 * r - 40);
      if (
        this.jellies.some((o) => {
          const c = o.center();
          return Math.hypot(c[0] - x, c[1] - y) < o.r + r + 12;
        })
      )
        continue;
      const j = this.spawn(x, y, cls, r, r * 0.3);
      const a = this.rnd() * 6.28;
      this.setVel(j, (Math.cos(a) * this.P.speed) / SUB, (Math.sin(a) * this.P.speed) / SUB);
      return true;
    }
    return false;
  }

  /** 1 段小さいゼリー 2 個に、長い軸の向きで分ける */
  private splitJelly(j: Jelly) {
    const { W, H } = this;
    const c = j.center();
    const v = j.vel();
    const N = j.n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < N; i++) {
      const dx = j.p[i][0] - c[0];
      const dy = j.p[i][1] - c[1];
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const cls = j.cls - 1;
    const tr = this.rad(cls);
    const mg = Math.max(30 * this.k, tr * 0.9);
    for (const sg of [-1, 1]) {
      const x = Math.min(W - mg, Math.max(mg, c[0] + sg * ux * tr * 0.9));
      const y = Math.min(H - mg, Math.max(mg, c[1] + sg * uy * tr * 0.9));
      // 面積を保つ（2 個で元と同じ面積になる半径 ×0.968）。生まれた直後は小さく、少しずつ育つ
      const kid = this.spawn(x, y, cls, tr * 0.968, tr * 0.7, j.hue);
      this.setVel(kid, v[0] + (sg * ux * 1.6) / SUB, v[1] + (sg * uy * 1.6) / SUB);
    }
    this.stats.splits++;
    this.fx.push({ x: c[0], y: c[1], r: j.r * 0.6, t: 0, L: 24, g: 1.2 });
  }

  /** 1 フレーム（1/60 秒）進める */
  step() {
    const P = this.P;
    this.pending = [];
    for (let s = 0; s < SUB; s++) this.stepSub(DT / SUB);
    for (const [A, B] of this.pending) this.mergePair(A, B);
    if (this.pending.length) this.jellies = this.jellies.filter((j) => !j.dead);
    for (const j of this.jellies) {
      // 成長（大きさと色を、目標へゆっくり近づける）
      j.t++;
      j.rebuild(Math.abs(j.tr - j.r) > 0.05 ? j.r + (j.tr - j.r) * 0.06 : j.r, P.amoeba);
      const dh = ((j.hueTo - j.hue + 540) % 360) - 180;
      j.hue = (j.hue + dh * 0.08 + 360) % 360;
    }
    this.regulate();
    const evFrames = Math.max(1, P.evSec * 60);
    if (this.ev) {
      // 臨界点の演出
      const ev = this.ev;
      ev.t++;
      const j = ev.j;
      const decay = Math.max(0, 1 - ev.t / evFrames);
      if (j.dead || ev.t > evFrames) {
        if (!j.dead) this.mode = 'split'; // 演出が終わったら、分裂フェーズへ
        this.ev = null;
      } else {
        const c = j.center();
        if (ev.t % 10 === 1 && ev.t < 70) this.fx.push({ x: c[0], y: c[1], r: j.r * 0.5, t: 0, L: 50, g: 2.6 }); // 輪が何重にも広がる
        const s0 = 1 + 0.14 * decay * Math.sin(((ev.t - 1) * 2 * Math.PI) / 34);
        const s1 = 1 + 0.14 * decay * Math.sin((ev.t * 2 * Math.PI) / 34);
        const f = s1 / s0; // 大きく脈打つ
        for (let i = 0; i < j.n; i++) {
          j.p[i][0] = c[0] + (j.p[i][0] - c[0]) * f;
          j.p[i][1] = c[1] + (j.p[i][1] - c[1]) * f;
        }
      }
    }
    for (const f of this.fx) f.t++;
    while (this.fx.length && this.fx[0].t > (this.fx[0].L || 30)) this.fx.shift();
    this.frame++;
    const splitCool = P.splitCoolSec * 60;
    for (const j of this.jellies.slice()) {
      // 分裂フェーズ: ぶつかったゼリーは 2 個に分かれる
      j.age++;
      if (this.mode === 'split' && !this.ev && j.hit && j.age > splitCool && j.cls > P.minCls && this.jellies.length < P.splitCap) {
        j.dead = true;
        this.splitJelly(j);
        this.splitIdle = 0;
      }
      j.hit = false;
    }
    if (this.jellies.some((j) => j.dead)) this.jellies = this.jellies.filter((j) => !j.dead);
    // 個数の上限などで分裂が進まなくなったら（10 秒）、成長に戻す。永久に分裂モードで止まらないように
    if (this.mode === 'split' && !this.ev) this.splitIdle++;
    else this.splitIdle = 0;
    if (this.mode === 'split' && !this.ev && (this.splitIdle > 600 || this.jellies.every((j) => j.cls <= P.minCls))) {
      this.mode = 'grow'; // 小さくなりきったら、また成長へ
      this.stats.cycles++;
    }
    if (this.mode === 'grow' && !this.ev && this.frame % 20 === 0 && this.totalArea() < P.fill * this.W * this.H) this.spawnOne();
    this.stats.top = this.jellies.filter((j) => j.cls === TOP).length;
  }
}

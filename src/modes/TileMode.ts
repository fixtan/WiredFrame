import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IMode } from '../core/IMode';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { updateTileAnimation } from './tile-animations/flatWave';
import { updateSpiralAnimation } from './tile-animations/spiralFlow';
import { updateMatrixAnimation } from './tile-animations/matrixRain';
import { updateCylinderAnimation } from './tile-animations/cylinderWrap';
import { updateCardScatterAnimation } from './tile-animations/cardScatter';
import { updateRippleAnimation } from './tile-animations/rippleRadial';
import { updateTunnelAnimation } from './tile-animations/tunnelDepth';
import { updateDoubleHelixAnimation } from './tile-animations/doubleHelix';
import { updateCrystalAnimation } from './tile-animations/crystalForm';

export class TileMode implements IMode {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private group = new THREE.Group();
  private textureLoader = new THREE.TextureLoader();

  private playMode: string = 'rotation'; // 'rotation' | 'random' | 'fixed'
  private fixedPattern: string = 'tile'; // 固定時のパターン名

  // --- 設定パラメータ ---
  private imagePaths: string[] = [];
  private tileSize: number = 2.0;
  private spacingX: number = 4.5;
  private spacingY: number = 2.8;
  private cols: number = 10;
  private rows: number = 6;
  private fitGrid: boolean = false;
  private imageMaxSize: number = 0; // 0: 元の大きさのまま。>0: 長辺をこの値まで縮小して読む（画質と引き換えに軽くする）
  private brightness: number = 100; // %。タイルと背景に掛ける
  // タイル再構築の世代。古い世代のテクスチャ読み込みが完了しても使わない（解放済みのため）
  private buildGen = 0;
  // 今のタイルが使っているテクスチャ（同じ画像のタイルで共有するので、まとめて 1 回ずつ解放する）
  private textures: THREE.Texture[] = [];
  private bgColor: string = '#000000';
  private bgImagePath: string = '';
  private currentDir: string = '';

  // --- アニメーションパターン管理 ---
  private patternIndex = 0;
  private patternTimer = 0;
  private switchInterval = 12;
  private totalPatterns = 10;

  private patternNameMap: { [key: string]: number } = {
    'tile': 0,
    'cardScatter': 5,
    'crystalForm': 9,
    'cylinderWrap': 4,
    'doubleHelix': 8,
    'flatWave': 0,
    'matrixRain': 3,
    'rippleRadial': 6,
    'spiralFlow': 2,
    'tunnelDepth': 7,
  };

  setSwitchInterval(sec: number) {
    this.switchInterval = sec;
  }

  public setPlayConfig(mode: string, pattern: string) {
    this.playMode = mode;
    this.fixedPattern = pattern;
    this.applyCurrentMode();
  }

  public applyCurrentMode() {
    if (this.playMode === 'fixed') {
      const targetIdx = this.patternNameMap[this.fixedPattern];
      if (targetIdx !== undefined) {
        this.patternIndex = targetIdx;
      }
      this.patternTimer = 0;
    }
  }

  // 🆕 外観設定の反映とタイルの再構築
  public async setAppearanceConfig(config: {
    tileSize: number;
    spacingX: number;
    spacingY: number;
    cols: number;
    rows: number;
    fitGrid: boolean;
    imageMaxSize: number;
    bgColor: string;
    bgImagePath: string;
  }) {
    this.tileSize = config.tileSize;
    this.spacingX = config.spacingX;
    this.spacingY = config.spacingY;
    this.cols = config.cols;
    this.rows = config.rows;
    this.fitGrid = config.fitGrid;
    this.imageMaxSize = config.imageMaxSize;
    this.bgColor = config.bgColor;
    this.bgImagePath = config.bgImagePath;

    // 背景（単色または画像）の適用
    this.updateBackground();

    // サイズや間隔が変わったのでタイル群を再生成
    await this.rebuildTiles();
  }

  private updateBackground() {
    if (!this.scene) return;

    if (this.bgImagePath) {
      const bgUrl = this.bgImagePath.startsWith('http') ? this.bgImagePath : convertFileSrc(this.bgImagePath);
      this.textureLoader.load(bgUrl, (texture) => {
        texture.generateMipmaps = true;
        // 色空間の指定がないと線形として扱われ、全体が白っぽくなる
        texture.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = texture;
        this.scene.backgroundIntensity = this.gain();
      }, undefined, (err) => {
        console.warn("背景画像の読み込みに失敗しました。単色に戻します。", err);
        this.setColorBackground();
      });
    } else {
      this.setColorBackground();
    }
  }

  /** 明るさ（%）を、見た目に比例するように（ガンマ補正して）線形の倍率にする */
  private gain(): number {
    return Math.pow(this.brightness / 100, 2.2);
  }

  private setColorBackground() {
    this.scene.background = new THREE.Color(this.bgColor).multiplyScalar(this.gain());
  }

  /** 明るさ（%）。タイルと背景に即反映する（タイルは作り直さない） */
  setBrightness(percent: number) {
    this.brightness = percent;
    const k = this.gain();
    for (const child of this.group.children) {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat.map) mat.color.setScalar(k);
    }
    if (!this.scene) return;
    if (this.scene.background instanceof THREE.Texture) {
      this.scene.backgroundIntensity = k;
    } else {
      this.setColorBackground();
    }
  }

  // 画像フォルダを読み直してタイルを作り直す。
  // 空文字・読めないフォルダ・画像が 0 枚のフォルダは、前の画像を引きずらず、代わりの画像にする
  // （モニターごとにフォルダが違うので、前の画像が残ると別のモニターの設定が混ざって見える）
  async updateImageDirectory(newDir: string) {
    this.currentDir = newDir;
    this.imagePaths = [];
    if (newDir) {
      try {
        const files = await invoke<string[]>('get_images_from_dir', { dirPath: newDir });
        if (files && files.length > 0) {
          this.imagePaths = files;
        } else {
          console.warn(`画像フォルダに画像が無い: ${newDir}`);
        }
      } catch (e) {
        console.warn(`画像フォルダを読めない: ${newDir}`, e);
      }
    }

    await this.rebuildTiles();
  }

  /**
   * 画像 1 枚をテクスチャにする。同時に読むのは 3 枚まで（6 画面が一斉に読んで固まるのを避ける）。
   * imageMaxSize > 0 のときは、長辺をその値まで縮小してから GPU に渡す。
   */
  private makeTextureLoader(gen: number) {
    const cache = new Map<string, Promise<{ texture: THREE.Texture; aspect: number } | null>>();
    const maxSize = this.imageMaxSize;
    const light = maxSize > 0;
    const waiting: (() => void)[] = [];
    let running = 0;
    const acquire = () =>
      new Promise<void>((resolve) => {
        const go = () => { running++; resolve(); };
        if (running < 3) go(); else waiting.push(go);
      });
    const release = () => { running--; waiting.shift()?.(); };

    const decode = async (url: string): Promise<{ texture: THREE.Texture; aspect: number }> => {
      let texture: THREE.Texture;
      let w: number;
      let h: number;
      if (light) {
        const blob = await (await fetch(url)).blob();
        const full = await createImageBitmap(blob);
        w = full.width;
        h = full.height;
        const k = Math.min(1, maxSize / Math.max(w, h));
        let bmp: ImageBitmap = full;
        if (k < 1) {
          bmp = await createImageBitmap(full, {
            resizeWidth: Math.max(1, Math.round(w * k)),
            resizeHeight: Math.max(1, Math.round(h * k)),
            resizeQuality: 'high',
            imageOrientation: 'flipY',
          });
          full.close();
        } else {
          bmp = await createImageBitmap(full, { imageOrientation: 'flipY' });
          full.close();
        }
        texture = new THREE.Texture(bmp);
        texture.flipY = false; // ImageBitmap は上で反転済み
      } else {
        texture = await this.textureLoader.loadAsync(url);
        const img = texture.image as { width: number; height: number };
        w = img.width;
        h = img.height;
      }
      texture.generateMipmaps = true;
      texture.colorSpace = THREE.SRGBColorSpace; // 指定がないと全体が白っぽくなる
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = light ? 4 : 16;
      texture.needsUpdate = true;
      return { texture, aspect: w && h ? w / h : 1 };
    };

    return (url: string) => {
      let p = cache.get(url);
      if (!p) {
        p = (async () => {
          await acquire();
          try {
            const r = await decode(url);
            if (gen !== this.buildGen) {
              r.texture.dispose(); // 読み込み中にタイルが作り直された
              return null;
            }
            this.textures.push(r.texture);
            return r;
          } catch (e) {
            console.warn(`画像を読めない: ${url}`, e);
            return null;
          } finally {
            release();
          }
        })();
        cache.set(url, p);
      }
      return p;
    };
  }

  // 🆕 タイル群の生成・再構築処理
  private async rebuildTiles() {
    if (this.imagePaths.length === 0) {
      this.imagePaths = [
        'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600',
        'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600',
      ];
    }

    // ここから先は await を挟まない。既存のタイルを解放してクリアし、作り直す
    // （await の前にクリアすると、並行して呼ばれたときにタイルが二重に作られる）
    const gen = ++this.buildGen;
    this.disposeTiles();

    const cols = this.cols;
    const rows = this.rows;
    const totalTiles = cols * rows;
    const baseHeight = this.tileSize;
    const getTexture = this.makeTextureLoader(gen);

    for (let i = 0; i < totalTiles; i++) {
      const rawPath = this.imagePaths[i % this.imagePaths.length];
      const imgUrl = rawPath.startsWith('http') ? rawPath : convertFileSrc(rawPath);

      const geometry = new THREE.PlaneGeometry(baseHeight, baseHeight);
      const material = new THREE.MeshBasicMaterial({
        color: 0x222222,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });

      const mesh = new THREE.Mesh(geometry, material);

      void getTexture(imgUrl).then((r) => {
        if (!r || gen !== this.buildGen) return;
        if (r.aspect) {
          mesh.geometry.dispose();
          mesh.geometry = new THREE.PlaneGeometry(baseHeight * r.aspect, baseHeight);
        }
        material.map = r.texture;
        material.color.setScalar(this.gain());
        material.needsUpdate = true;
      });

      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - cols / 2 + 0.5) * this.spacingX;
      const y = (row - rows / 2 + 0.5) * this.spacingY;
      const z = (i % 3) * 0.05;

      mesh.position.set(x, y, z);

      mesh.userData = {
        flatPos: new THREE.Vector3(x, y, z),
        spherePos: this.calcSpherePosition(i, totalTiles),
        colIndex: col,
        rowIndex: row,
      };

      this.group.add(mesh);
    }

    // アニメーション側がグリッドの列数・行数を知るための情報
    this.group.userData.cols = cols;
    this.group.userData.rows = rows;

    this.fitCamera();
  }

  /** グループ内のタイルを解放して空にする */
  private disposeTiles() {
    for (const child of [...this.group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.dispose();
    }
    this.group.clear();
    for (const t of this.textures) t.dispose();
    this.textures = [];
  }

  /**
   * カメラ距離を決める。fitGrid が OFF なら従来どおり 30。
   * ON のときは、平面配置のグリッド全体が画面（縦・横どちらも）に収まる距離にする。
   */
  private fitCamera() {
    if (!this.camera) return;
    let z = 30;
    if (this.fitGrid) {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      // タイルの幅は画像の縦横比で変わるので、横長（最大 1.6 倍）を見込む
      const w = (this.cols - 1) * this.spacingX + this.tileSize * 1.6;
      const h = (this.rows - 1) * this.spacingY + this.tileSize;
      const zForH = h / 2 / tanHalf;
      const zForW = w / 2 / (tanHalf * this.camera.aspect);
      z = Math.max(zForH, zForW) * 1.05;
    }
    this.camera.position.set(0, 0, z);
  }

  onResize() {
    this.fitCamera();
  }

  async init(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.camera.position.set(0, 0, 30);

    // 初期背景の適用
    this.updateBackground();

    const canvas = document.querySelector('canvas');
    if (canvas) {
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
    }

    // 初回タイルビルド
    await this.updateImageDirectory(this.currentDir);

    this.scene.add(this.group);
  }

  private calcSpherePosition(index: number, total: number): THREE.Vector3 {
    const phi = Math.acos(-1 + (2 * index) / total);
    const theta = Math.sqrt(total * Math.PI) * phi;
    const radius = 18;
    return new THREE.Vector3(
      radius * Math.cos(theta) * Math.sin(phi),
      radius * Math.sin(theta) * Math.sin(phi),
      radius * Math.cos(phi)
    );
  }

  update(delta: number, time: number) {
    if (this.playMode === 'rotation') {
      this.patternTimer += delta;
      if (this.patternTimer >= this.switchInterval) {
        this.patternTimer = 0;
        this.patternIndex = (this.patternIndex + 1) % this.totalPatterns;
      }
    } else if (this.playMode === 'random') {
      this.patternTimer += delta;
      if (this.patternTimer >= this.switchInterval) {
        this.patternTimer = 0;
        let nextIdx = this.patternIndex;
        while (nextIdx === this.patternIndex && this.totalPatterns > 1) {
          nextIdx = Math.floor(Math.random() * this.totalPatterns);
        }
        this.patternIndex = nextIdx;
      }
    } else if (this.playMode === 'fixed') {
      const targetIdx = this.patternNameMap[this.fixedPattern];
      if (targetIdx !== undefined) {
        this.patternIndex = targetIdx;
      }
    }

    switch (this.patternIndex) {
      case 0:
        updateTileAnimation(this.group, time, false);
        break;
      case 1:
        updateTileAnimation(this.group, time, true);
        break;
      case 2:
        updateSpiralAnimation(this.group, time);
        break;
      case 3:
        updateMatrixAnimation(this.group, time);
        break;
      case 4:
        updateCylinderAnimation(this.group, time);
        break;
      case 5:
        updateCardScatterAnimation(this.group, time);
        break;
      case 6:
        updateRippleAnimation(this.group, time);
        break;
      case 7:
        updateTunnelAnimation(this.group, time);
        break;
      case 8:
        updateDoubleHelixAnimation(this.group, time);
        break;
      case 9:
        updateCrystalAnimation(this.group, time);
        break;
    }

    if (this.controls) {
      this.controls.update();
    }
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.code === 'Space') {
      this.patternIndex = (this.patternIndex + 1) % this.totalPatterns;
      this.patternTimer = 0;
    }
  }

  dispose() {
    if (this.controls) {
      this.controls.dispose();
    }
    this.scene.remove(this.group);
    this.buildGen++;
    this.disposeTiles();
  }
}

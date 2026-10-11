import { AppManager } from './core/AppManager';
import { TileMode } from './modes/TileMode';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event'; // 👈 ここに追加！
import { getCurrentWindow, availableMonitors } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const SETTINGS_KEY = 'wiredframe_settings_v1';

// デフォルト設定値
const DEFAULT_SETTINGS = {
  targetDir: "",
  intervalSec: 12,
  playMode: "rotation",
  fixedPattern: "tile",
  tileSize: 2.0,
  spacingX: 4.5,
  spacingY: 2.8,
  bgColor: "#000000",
  bgImagePath: "",
  multiMonitor: false,
};

const appContainer = document.querySelector('#app') as HTMLElement;
if (appContainer) {
  const manager = new AppManager(appContainer);
  const tileMode = new TileMode();
  manager.switchMode(tileMode);

  const settingsModal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('close-settings');
  const saveBtn = document.getElementById('save-settings');
  const resetBtn = document.getElementById('reset-settings');
  const browseBtn = document.getElementById('browse-btn');
  const pathInput = document.getElementById('input-path') as HTMLInputElement;
  const intervalInput = document.getElementById('input-interval') as HTMLInputElement;

  const playModeSelect = document.getElementById('select-play-mode') as HTMLSelectElement;
  const fixedPatternContainer = document.getElementById('fixed-pattern-container') as HTMLElement;
  const fixedPatternSelect = document.getElementById('select-fixed-pattern') as HTMLSelectElement;

  const browseBgBtn = document.getElementById('browse-bg-btn');
  const bgImageInput = document.getElementById('input-bg-image') as HTMLInputElement;

  const tileSizeInput = document.getElementById('input-tile-size') as HTMLInputElement;
  const spacingXInput = document.getElementById('input-spacing-x') as HTMLInputElement;
  const spacingYInput = document.getElementById('input-spacing-y') as HTMLInputElement;
  const bgColorInput = document.getElementById('input-bg-color') as HTMLInputElement;

  const multiMonitorInput = document.getElementById('input-multi-monitor') as HTMLInputElement;

  // ⚙ 設定をUIフォームとアプリに適用するヘルパー関数
  const applySettingsToApp = async (settings: typeof DEFAULT_SETTINGS, isInitial = false) => {
    pathInput.value = settings.targetDir;
    intervalInput.value = settings.intervalSec.toString();
    playModeSelect.value = settings.playMode;
    fixedPatternSelect.value = settings.fixedPattern;
    fixedPatternContainer.style.display = settings.playMode === 'fixed' ? 'block' : 'none';

    tileSizeInput.value = settings.tileSize.toString();
    spacingXInput.value = settings.spacingX.toString();
    spacingYInput.value = settings.spacingY.toString();
    bgColorInput.value = settings.bgColor;
    bgImageInput.value = settings.bgImagePath;

    multiMonitorInput.checked = settings.multiMonitor;
        // TileModeへ反映
    tileMode.setSwitchInterval(settings.intervalSec);
    if (typeof (tileMode as any).setPlayConfig === 'function') {
      (tileMode as any).setPlayConfig(settings.playMode, settings.fixedPattern);
    }
    if (typeof (tileMode as any).setAppearanceConfig === 'function') {
      await (tileMode as any).setAppearanceConfig({
        tileSize: settings.tileSize,
        spacingX: settings.spacingX,
        spacingY: settings.spacingY,
        bgColor: settings.bgColor,
        bgImagePath: settings.bgImagePath
      });
    }

    if (isInitial) {
      await tileMode.updateImageDirectory(settings.targetDir);
    }
  };

  // 🚀 起動時に保存された設定をロードして適用
  const loadSavedSettings = async () => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      const settings = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
      await applySettingsToApp(settings, true);
    } catch (e) {
      console.error('設定のロードに失敗しました:', e);
      await applySettingsToApp(DEFAULT_SETTINGS, true);
    }
  };

  loadSavedSettings();

  // 🖥️ マルチモニター対応の展開を実行
  initMultiMonitor();

  // 🖥️ マルチモニター自動展開の初期化関数（Rust側に委譲）
  async function initMultiMonitor() {
    try {
      const currentWin = getCurrentWindow();
      const currentLabel = currentWin.label;

      // メインウィンドウ以外では実行しない
      if (currentLabel !== 'main') return;

      // 設定でマルチモニターが無効なら展開しない
      const saved = localStorage.getItem(SETTINGS_KEY);
      const settings = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
      if (!settings.multiMonitor) {
        console.log('シングルウィンドウモードで動作します');
        return;
      }

      console.log('Rust側でマルチモニターウィンドウを展開します...');
      await invoke('open_sub_monitors');
    } catch (err) {
      console.error('マルチモニター初期化エラー:', err);
    }
  }


  // ⚙ タスクトレイからのイベント
  listen('open-settings', () => {
    settingsModal?.classList.add('open');
  });

  closeBtn?.addEventListener('click', () => {
    settingsModal?.classList.remove('open');
  });

  // 📁 フォルダ参照
  browseBtn?.addEventListener('click', async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: pathInput.value || undefined,
      });
      if (selected && typeof selected === 'string') {
        pathInput.value = selected;
      }
    } catch (err) {
      console.error('フォルダ選択エラー:', err);
    }
  });

  // 🖼️ 背景画像参照
  browseBgBtn?.addEventListener('click', async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
      });
      if (selected && typeof selected === 'string') {
        bgImageInput.value = selected;
      }
    } catch (err) {
      console.error('背景画像選択エラー:', err);
    }
  });

  playModeSelect?.addEventListener('change', () => {
    fixedPatternContainer.style.display = playModeSelect.value === 'fixed' ? 'block' : 'none';
  });

  // 💾 保存ボタン
  saveBtn?.addEventListener('click', async () => {
    const newSettings = {
      targetDir: pathInput.value,
      intervalSec: parseFloat(intervalInput.value) || 12,
      playMode: playModeSelect.value,
      fixedPattern: fixedPatternSelect.value,
      tileSize: parseFloat(tileSizeInput.value) || 2.0,
      spacingX: parseFloat(spacingXInput.value) || 4.5,
      spacingY: parseFloat(spacingYInput.value) || 2.8,
      bgColor: bgColorInput.value,
      bgImagePath: bgImageInput.value,
      multiMonitor: multiMonitorInput.checked,
    };

    // localStorageに保存
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));

    // アプリに反映
    tileMode.setSwitchInterval(newSettings.intervalSec);
    (tileMode as any).setPlayConfig?.(newSettings.playMode, newSettings.fixedPattern);
    await (tileMode as any).setAppearanceConfig?.({
      tileSize: newSettings.tileSize,
      spacingX: newSettings.spacingX,
      spacingY: newSettings.spacingY,
      bgColor: newSettings.bgColor,
      bgImagePath: newSettings.bgImagePath
    });
    await tileMode.updateImageDirectory(newSettings.targetDir);

    settingsModal?.classList.remove('open');
  });

  // 🔄 デフォルトに戻すボタン
  resetBtn?.addEventListener('click', async () => {
    if (confirm('設定を初期状態に戻しますか？')) {
      localStorage.removeItem(SETTINGS_KEY);
      await applySettingsToApp(DEFAULT_SETTINGS, true);
      settingsModal?.classList.remove('open');
    }
  });

  const appWin = getCurrentWindow();

  // 🖥️ F11キーでRust経由全ウィンドウ連動のフルスクリーン切替、Escで解除
  window.addEventListener('keydown', async (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      try {
        const isFs = await appWin.isFullscreen();
        const nextState = !isFs;

        // Rust側コマンドを呼び出して、全モニターのウィンドウを一括フルスクリーン切替
        await invoke('set_fullscreen_all', { fullscreen: nextState });
      } catch (err) {
        console.error('フルスクリーン切替エラー:', err);
      }
    } else if (e.key === 'Escape') {
      try {
        if (await appWin.isFullscreen()) {
          await invoke('set_fullscreen_all', { fullscreen: false });
        }
      } catch (err) {
        console.error('フルスクリーン解除エラー:', err);
      }
    }
  });
}

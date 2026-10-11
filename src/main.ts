import { AppManager } from './core/AppManager';
import { TileMode } from './modes/TileMode';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow, availableMonitors } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { initDebug, dlog, derr } from './debug';
import {
  type AppSettings,
  SETTINGS_CHANGED_EVENT,
  loadGlobal,
  loadEffectiveSettings,
  resolveMonitorKey,
  saveGlobal,
  saveMonitorDefault,
  resetSettings,
} from './settings';

// デバッグ基盤（ログ転送・エラー捕捉・F2オーバーレイ）。他の処理より前に初期化する
initDebug();

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
  const applySettingsToApp = async (settings: AppSettings, isInitial = false) => {
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

  // このウィンドウがいるモニターの保存キー（起動時に決まる。決まるまでは 'unknown'）
  let myMonitorKey = 'unknown';

  // 🚀 保存された設定を読み直して適用する（起動時と、設定が保存されたとき）
  const loadAndApply = async (reason: string) => {
    try {
      const settings = loadEffectiveSettings(myMonitorKey, reason);
      await applySettingsToApp(settings, true);
    } catch (e) {
      derr(`設定の適用に失敗 (${reason}):`, e);
    }
  };

  (async () => {
    myMonitorKey = await resolveMonitorKey();
    await loadAndApply('boot');
  })();

  // 設定が保存されたら、全ウィンドウ（保存した main も含む）が同じ経路で読み直して適用する
  listen(SETTINGS_CHANGED_EVENT, () => {
    void loadAndApply(SETTINGS_CHANGED_EVENT);
  }).catch((e) => derr(`${SETTINGS_CHANGED_EVENT} の購読に失敗:`, e));

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
      if (!loadGlobal().multiMonitor) {
        dlog('シングルウィンドウモードで動作します');
        return;
      }

      dlog('Rust側でマルチモニターウィンドウを展開します...');
      await invoke('open_sub_monitors');
    } catch (err) {
      console.error('マルチモニター初期化エラー:', err);
    }
  }


  // ⚙ タスクトレイからのイベント
  const isMain = getCurrentWindow().label === 'main';
  listen('open-settings', () => {
    if (!isMain) return;
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
  // 設定の保存・リセットのあとに、全ウィンドウへ「読み直して適用して」と知らせる。
  // 配信に失敗したときは、せめて自分のウィンドウだけでも適用する。
  const notifySettingsChanged = async () => {
    try {
      await emit(SETTINGS_CHANGED_EVENT);
    } catch (e) {
      derr(`${SETTINGS_CHANGED_EVENT} の配信に失敗。このウィンドウだけ適用する:`, e);
      await loadAndApply('local-fallback');
    }
  };

  saveBtn?.addEventListener('click', async () => {
    // 共通（画像フォルダ・マルチモニター）
    saveGlobal({
      targetDir: pathInput.value,
      multiMonitor: multiMonitorInput.checked,
    });

    // Step 3 までは、このパネルは「モニター共通の既定値」を編集する
    saveMonitorDefault({
      intervalSec: parseFloat(intervalInput.value) || 12,
      playMode: playModeSelect.value,
      fixedPattern: fixedPatternSelect.value,
      tileSize: parseFloat(tileSizeInput.value) || 2.0,
      spacingX: parseFloat(spacingXInput.value) || 4.5,
      spacingY: parseFloat(spacingYInput.value) || 2.8,
      bgColor: bgColorInput.value,
      bgImagePath: bgImageInput.value,
    });

    await notifySettingsChanged();
    settingsModal?.classList.remove('open');
  });

  // 🔄 デフォルトに戻すボタン
  resetBtn?.addEventListener('click', async () => {
    if (confirm('設定を初期状態に戻しますか？')) {
      resetSettings(myMonitorKey);
      await notifySettingsChanged();
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

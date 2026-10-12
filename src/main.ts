import { AppManager } from './core/AppManager';
import { TileMode } from './modes/TileMode';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { initDebug, dlog, derr } from './debug';
import {
  type AppSettings,
  type GlobalSettings,
  type MonitorSettings,
  DEFAULT_MONITOR,
  GRID_MIN,
  GRID_MAX,
  SETTINGS_CHANGED_EVENT,
  loadGlobal,
  loadEffectiveSettings,
  resolveMonitorKey,
  saveGlobal,
  saveMonitor,
  resetMonitor,
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
  const colsInput = document.getElementById('input-cols') as HTMLInputElement;
  const rowsInput = document.getElementById('input-rows') as HTMLInputElement;
  const fitGridInput = document.getElementById('input-fit-grid') as HTMLInputElement;
  const bgColorInput = document.getElementById('input-bg-color') as HTMLInputElement;

  const multiMonitorInput = document.getElementById('input-multi-monitor') as HTMLInputElement;

  const isMain = getCurrentWindow().label === 'main';
  const panelMonitorLabel = document.getElementById('panel-monitor-label');
  const globalSections = [
    document.getElementById('global-section'),
    document.getElementById('global-section-2'),
  ];

  // このウィンドウがいるモニターの保存キー（起動時に決まる。決まるまでは 'unknown'）
  let myMonitorKey = 'unknown';

  // 適用処理は 1 本ずつ順番に実行する（タイル再構築が重なって壊れないように）
  let applyChain: Promise<void> = Promise.resolve();
  const enqueue = (label: string, fn: () => Promise<void>) => {
    applyChain = applyChain.then(fn).catch((e) => derr(`${label} に失敗:`, e));
    return applyChain;
  };

  // 直近に TileMode へ渡した見た目の設定（変わっていなければタイルを作り直さない）
  let lastAppearance = '';
  // パネルで編集中（プレビュー中）で、まだ保存していない変更があるか
  let dirty = false;
  // main のパネルを開いた時点の共通設定（保存時に変わったかを見る）
  let globalAtOpen = loadGlobal();

  const isPanelOpen = () => settingsModal?.classList.contains('open') ?? false;

  // ⚙ 設定をフォームに入れる（モニター別の欄は全ウィンドウ、共通の欄は main だけ使う）
  const fillForm = (settings: AppSettings) => {
    pathInput.value = settings.targetDir;
    intervalInput.value = settings.intervalSec.toString();
    playModeSelect.value = settings.playMode;
    fixedPatternSelect.value = settings.fixedPattern;
    fixedPatternContainer.style.display = settings.playMode === 'fixed' ? 'block' : 'none';
    tileSizeInput.value = settings.tileSize.toString();
    spacingXInput.value = settings.spacingX.toString();
    spacingYInput.value = settings.spacingY.toString();
    colsInput.value = settings.cols.toString();
    rowsInput.value = settings.rows.toString();
    fitGridInput.checked = settings.fitGrid;
    bgColorInput.value = settings.bgColor;
    bgImageInput.value = settings.bgImagePath;
    multiMonitorInput.checked = settings.multiMonitor;
  };

  // 🎬 設定を TileMode に反映する。reloadDir=true のときは画像フォルダも読み直す
  const applyToTileMode = async (settings: AppSettings, reloadDir: boolean) => {
    tileMode.setSwitchInterval(settings.intervalSec);
    tileMode.setPlayConfig(settings.playMode, settings.fixedPattern);

    const appearance = {
      tileSize: settings.tileSize,
      spacingX: settings.spacingX,
      spacingY: settings.spacingY,
      cols: settings.cols,
      rows: settings.rows,
      fitGrid: settings.fitGrid,
      bgColor: settings.bgColor,
      bgImagePath: settings.bgImagePath,
    };
    const appearanceKey = JSON.stringify(appearance);
    if (reloadDir || appearanceKey !== lastAppearance) {
      lastAppearance = appearanceKey;
      await tileMode.setAppearanceConfig(appearance);
    }
    if (reloadDir) {
      await tileMode.updateImageDirectory(settings.targetDir);
    }
  };

  // セーバーの起動に必要な設定を Rust に渡す（Rust だけで起動できるように）。main だけが渡す
  type SaverState = { running: boolean; settingsMode: boolean };
  const pushSaverConfig = (s: AppSettings) => {
    invoke('set_saver_config', { config: { multiMonitor: s.multiMonitor } }).catch((e) =>
      derr('set_saver_config に失敗:', e),
    );
  };

  // 🚀 保存された設定を読み直して、フォームと画面に適用する
  const loadAndApply = (reason: string, reloadDir = true) =>
    enqueue(`設定の適用 (${reason})`, async () => {
      const settings = loadEffectiveSettings(myMonitorKey, reason);
      fillForm(settings);
      if (isMain) pushSaverConfig(settings);
      await applyToTileMode(settings, reloadDir);
      dirty = false;
    });

  (async () => {
    myMonitorKey = await resolveMonitorKey();
    await loadAndApply('boot');
    // 「設定」で起動したセーバーのサブウィンドウは、起動時にパネルを開く（open-settings に間に合わないため）
    if (!isMain) {
      try {
        const st = await invoke<SaverState>('saver_state');
        if (st.settingsMode) queueMicrotask(() => openPanel());
      } catch (e) {
        derr('saver_state の取得に失敗:', e);
      }
    }
  })();

  // セーバーが起動した（main だけが受け取る）。画像フォルダの変更を拾うため、設定を読み直す
  listen('saver-started', (ev) => {
    dlog(`セーバー起動 (${String(ev.payload)})`);
    if (!isPanelOpen()) void loadAndApply('saver-started');
  }).catch((e) => derr('saver-started の購読に失敗:', e));
  listen('saver-stopped', (ev) => dlog(`セーバー終了 (${String(ev.payload)})`)).catch((e) =>
    derr('saver-stopped の購読に失敗:', e),
  );

  // 共通設定（画像フォルダなど）が保存されたら、全ウィンドウが読み直して適用する
  listen(SETTINGS_CHANGED_EVENT, () => {
    void loadAndApply(SETTINGS_CHANGED_EVENT);
  }).catch((e) => derr(`${SETTINGS_CHANGED_EVENT} の購読に失敗:`, e));

  // 🖥️ サブモニターを閉じて開き直す（ON/OFF の即時反映・構成変更・手動の再展開で共通）。
  // マルチモニターが OFF なら、閉じるだけ。
  let reexpanding = false;
  const reexpandSubMonitors = async (reason: string) => {
    if (!isMain) return;
    if (reexpanding) {
      dlog(`サブモニターの再展開は実行中なのでスキップ (${reason})`);
      return;
    }
    reexpanding = true;
    try {
      const closed = await invoke<number>('close_sub_monitors');
      dlog(`サブモニターを閉じた: ${closed} 枚 (${reason})`);
      if (loadGlobal().multiMonitor) {
        // 閉じたウィンドウのラベルが解放されるのを少し待ってから作り直す
        await new Promise((r) => setTimeout(r, 500));
        await invoke('open_sub_monitors');
        dlog(`サブモニターを展開した (${reason})`);
      }
    } catch (e) {
      derr(`サブモニターの再展開に失敗 (${reason}):`, e);
    } finally {
      reexpanding = false;
    }
  };

  // モニター構成が変わった（Rust が見張っている）。マルチモニター ON のときだけ展開し直す
  listen('monitors-changed', () => {
    if (!isMain) return;
    if (!loadGlobal().multiMonitor) {
      dlog('モニター構成が変わったが、マルチモニターは OFF なので何もしない');
      return;
    }
    void reexpandSubMonitors('monitors-changed');
  }).catch((e) => derr('monitors-changed の購読に失敗:', e));

  // トレイの「モニターを再展開」
  listen('reexpand-monitors', () => void reexpandSubMonitors('tray')).catch((e) =>
    derr('reexpand-monitors の購読に失敗:', e),
  );

  // ---- 設定パネル（各ウィンドウが自分のモニター用に開く） ----------------------

  /** フォームからモニター別の設定を読む。strict=true で不正な値があれば null（プレビュー用）。 */
  const readMonitorForm = (strict: boolean): MonitorSettings | null => {
    const num = (el: HTMLInputElement, def: number, positive = true): number | null => {
      const v = parseFloat(el.value);
      if (Number.isFinite(v) && (!positive || v > 0)) return v;
      return strict ? null : def;
    };
    const intervalSec = num(intervalInput, DEFAULT_MONITOR.intervalSec);
    const tileSize = num(tileSizeInput, DEFAULT_MONITOR.tileSize);
    const spacingX = num(spacingXInput, DEFAULT_MONITOR.spacingX);
    const spacingY = num(spacingYInput, DEFAULT_MONITOR.spacingY);
    const grid = (el: HTMLInputElement, def: number): number | null => {
      const v = Number(el.value);
      if (Number.isInteger(v) && v >= GRID_MIN && v <= GRID_MAX) return v;
      return strict ? null : def;
    };
    const cols = grid(colsInput, DEFAULT_MONITOR.cols);
    const rows = grid(rowsInput, DEFAULT_MONITOR.rows);
    if (intervalSec === null || tileSize === null || spacingX === null || spacingY === null || cols === null || rows === null) return null;
    return {
      intervalSec,
      playMode: playModeSelect.value,
      fixedPattern: fixedPatternSelect.value,
      tileSize,
      spacingX,
      spacingY,
      cols,
      rows,
      fitGrid: fitGridInput.checked,
      bgColor: bgColorInput.value,
      bgImagePath: bgImageInput.value,
    };
  };

  // ライブプレビュー: 入力が止まってから、このウィンドウにだけ適用する（保存はしない）
  let previewTimer: number | undefined;
  const schedulePreview = () => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      const m = readMonitorForm(true);
      if (!m) return; // 入力途中の不正な値は反映しない
      dirty = true;
      void enqueue('プレビュー', () => applyToTileMode({ ...loadGlobal(), ...m }, false));
    }, 400);
  };
  for (const el of [intervalInput, playModeSelect, fixedPatternSelect, tileSizeInput, spacingXInput, spacingYInput, colsInput, rowsInput, fitGridInput, bgColorInput, bgImageInput]) {
    el?.addEventListener('input', schedulePreview);
    el?.addEventListener('change', schedulePreview);
  }

  const openPanel = () => {
    if (isPanelOpen()) return;
    const settings = loadEffectiveSettings(myMonitorKey, 'open-settings');
    fillForm(settings);
    globalAtOpen = loadGlobal();
    dirty = false;
    for (const g of globalSections) if (g) g.style.display = isMain ? '' : 'none';
    if (panelMonitorLabel) {
      panelMonitorLabel.textContent = `モニター: ${myMonitorKey}` + (isMain ? '（main：共通設定も編集）' : '');
    }
    settingsModal?.classList.add('open');
  };

  /** パネルを閉じる。保存前のプレビューが残っていれば保存済みの状態に戻す。main が閉じたら全員に知らせる。 */
  const closePanel = async (revert: boolean, broadcast: boolean) => {
    window.clearTimeout(previewTimer);
    settingsModal?.classList.remove('open');
    if (revert && dirty) await loadAndApply('revert', false);
    dirty = false;
    if (broadcast) {
      try {
        await emit('close-settings');
      } catch (e) {
        derr('close-settings の配信に失敗:', e);
      }
      // 「設定」のために起動したセーバーは、設定を閉じたら終了する
      try {
        const st = await invoke<SaverState>('saver_state');
        if (st.settingsMode) await invoke('stop_saver', { reason: 'settings-closed' });
      } catch (e) {
        derr('設定モードの終了に失敗:', e);
      }
    }
  };

  // ⚙ タスクトレイからのイベント（全ウィンドウに届く）
  listen('open-settings', () => openPanel()).catch((e) => derr('open-settings の購読に失敗:', e));
  // main のパネルが閉じたら、サブのパネルも閉じる（未保存のプレビューは破棄）
  listen('close-settings', () => {
    if (isMain || !isPanelOpen()) return;
    void closePanel(true, false);
  }).catch((e) => derr('close-settings の購読に失敗:', e));

  closeBtn?.addEventListener('click', () => {
    void closePanel(true, isMain);
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
        schedulePreview();
      }
    } catch (err) {
      console.error('背景画像選択エラー:', err);
    }
  });

  playModeSelect?.addEventListener('change', () => {
    fixedPatternContainer.style.display = playModeSelect.value === 'fixed' ? 'block' : 'none';
  });

  // 💾 保存ボタン: このモニターの設定だけ保存する。main は共通設定も保存する
  saveBtn?.addEventListener('click', async () => {
    const m = readMonitorForm(false)!;
    saveMonitor(myMonitorKey, m);

    let globalChanged = false;
    let multiChanged = false;
    if (isMain) {
      const g: GlobalSettings = { targetDir: pathInput.value, multiMonitor: multiMonitorInput.checked };
      saveGlobal(g);
      multiChanged = g.multiMonitor !== globalAtOpen.multiMonitor;
      globalChanged = g.targetDir !== globalAtOpen.targetDir || multiChanged;
    }

    // プレビュー済みの内容と保存内容が違う（不正値の補正など）場合に備えて、保存値を適用し直す
    await loadAndApply('save', false);
    dirty = false;

    if (globalChanged) {
      // 画像フォルダの変更などを他のウィンドウにも反映させる（main 自身もこの経路で読み直す）
      try {
        await emit(SETTINGS_CHANGED_EVENT);
      } catch (e) {
        derr(`${SETTINGS_CHANGED_EVENT} の配信に失敗。このウィンドウだけ適用する:`, e);
        await loadAndApply('local-fallback');
      }
    }
    await closePanel(false, isMain);

    // マルチモニターの ON/OFF が変わったら、すぐサブモニターを開く／閉じる
    if (multiChanged) await reexpandSubMonitors('multiMonitor changed');
  });

  // 🔄 このモニターの専用設定を消して、既定値に戻す
  resetBtn?.addEventListener('click', async () => {
    if (confirm('このモニターの設定を初期状態（共通の既定値）に戻しますか？')) {
      resetMonitor(myMonitorKey);
      await loadAndApply('reset', false);
      await closePanel(false, isMain);
    }
  });

  // ⎋ ESC でセーバーを終了する（どのウィンドウでも）。設定パネルが開いている間は無視する
  window.addEventListener('keydown', async (e) => {
    if (e.key !== 'Escape' || isPanelOpen()) return;
    try {
      await invoke('stop_saver', { reason: 'esc' });
    } catch (err) {
      derr('stop_saver に失敗:', err);
    }
  });
}

//! スクリーンセーバーの起動・終了（ロードマップ 3.1）。
//!
//! アプリは起動してもウィンドウを出さず、トレイに常駐する。
//! 「起動」で main を全画面にし（マルチモニター ON ならサブも作り）、「終了」でサブを閉じて main を隠す。
//! main は破棄しない（設定の読み込みやイベントの受け口として常駐させる）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

use crate::{debug, log_if_err};

/// セーバーが動いているか。
static RUNNING: AtomicBool = AtomicBool::new(false);
/// 「設定」を開くために起動したか（main のパネルを閉じたら終了する）。
static SETTINGS_MODE: AtomicBool = AtomicBool::new(false);

/// フロント（設定）から Rust に渡す、起動に必要な設定。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaverConfig {
    pub multi_monitor: bool,
}

static CONFIG: Mutex<SaverConfig> = Mutex::new(SaverConfig { multi_monitor: false });

fn config() -> SaverConfig {
    CONFIG
        .lock()
        .map(|c| c.clone())
        .unwrap_or(SaverConfig { multi_monitor: false })
}

pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaverState {
    pub running: bool,
    pub settings_mode: bool,
}

// ---- サブモニターのウィンドウ ----------------------------------------------

/// サブモニターのウィンドウ（sub-monitor-*）をすべて閉じる。閉じた枚数を返す。
fn close_sub_windows(app: &AppHandle) -> usize {
    let mut n = 0;
    for (label, window) in app.webview_windows() {
        if label.starts_with("sub-monitor-") {
            log_if_err(&label, "destroy", window.destroy());
            n += 1;
        }
    }
    debug::log("rust", "info", &format!("サブモニターを {} 枚閉じた", n));
    n
}

/// main のあるモニター以外に、サブウィンドウを物理座標で作って全画面にする。
fn open_sub_windows(
    app: &AppHandle,
    main_pos: Option<PhysicalPosition<i32>>,
    always_on_top: bool,
) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    match main_pos {
        Some(p) => debug::log(
            "rust",
            "info",
            &format!("サブモニターの展開: main は pos=({},{}) のモニター上。ここは除外する", p.x, p.y),
        ),
        None => debug::log(
            "rust",
            "warn",
            "サブモニターの展開: main のモニターを特定できない。main と同じモニターにもサブができる",
        ),
    }
    crate::monitors::log_all(app, "open_sub_windows");

    for (i, m) in monitors.iter().enumerate() {
        if Some(*m.position()) == main_pos {
            debug::log("rust", "info", &format!("#{} は main のモニターなのでスキップ", i));
            continue;
        }

        let label = format!("sub-monitor-{}", i);
        if app.get_webview_window(&label).is_some() {
            debug::log("rust", "info", &format!("{} は作成済みなのでスキップ", label));
            continue;
        }

        // まずは非表示でビルドし、位置・サイズを決めてから表示 → 全画面（位置ズレを防ぐ）
        let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .decorations(false)
            .resizable(false)
            .visible(false)
            .always_on_top(always_on_top)
            .build()
            .map_err(|e| {
                let msg = format!("{} の作成に失敗: {}", label, e);
                debug::log("rust", "error", &msg);
                msg
            })?;

        log_if_err(&label, "set_position", w.set_position(PhysicalPosition::new(m.position().x, m.position().y)));
        log_if_err(&label, "set_size", w.set_size(PhysicalSize::new(m.size().width, m.size().height)));
        log_if_err(&label, "show", w.show());
        log_if_err(&label, "set_fullscreen", w.set_fullscreen(true));

        debug::log(
            "rust",
            "info",
            &format!(
                "{} を作成（モニター #{} {:?} pos=({},{}) size={}x{}）",
                label,
                i,
                m.name(),
                m.position().x,
                m.position().y,
                m.size().width,
                m.size().height
            ),
        );
    }
    Ok(())
}

// ---- 起動・終了 ------------------------------------------------------------

fn start_inner(app: &AppHandle, settings_mode: bool) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main ウィンドウが無い".to_string())?;
    let always_on_top = !settings_mode; // 設定モードでは、ダイアログが隠れないよう最前面にしない

    // main はプライマリモニターに置く
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.available_monitors().ok().and_then(|v| v.into_iter().next()));
    let main_pos = primary.as_ref().map(|m| *m.position());
    if let Some(m) = &primary {
        log_if_err("main", "set_position", main.set_position(PhysicalPosition::new(m.position().x, m.position().y)));
        log_if_err("main", "set_size", main.set_size(PhysicalSize::new(m.size().width, m.size().height)));
    } else {
        debug::log("rust", "warn", "プライマリモニターを特定できない。main は今の位置のまま全画面にする");
    }
    log_if_err("main", "set_always_on_top", main.set_always_on_top(always_on_top));
    log_if_err("main", "show", main.show());
    log_if_err("main", "set_fullscreen", main.set_fullscreen(true));
    log_if_err("main", "set_focus", main.set_focus());

    if config().multi_monitor {
        open_sub_windows(app, main_pos, always_on_top)?;
    }
    Ok(())
}

/// セーバーを起動する。すでに動いていれば何もしない。
pub fn start(app: &AppHandle, reason: &str, settings_mode: bool) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        debug::log("rust", "info", &format!("セーバーは起動済み ({})", reason));
        return;
    }
    SETTINGS_MODE.store(settings_mode, Ordering::SeqCst);
    debug::log(
        "rust",
        "info",
        &format!("セーバーを起動 reason={} settings_mode={} multi_monitor={}", reason, settings_mode, config().multi_monitor),
    );
    if let Err(e) = start_inner(app, settings_mode) {
        debug::log("rust", "error", &format!("セーバーの起動に失敗: {}", e));
    }
    if let Err(e) = app.emit_to("main", "saver-started", reason) {
        debug::log("rust", "error", &format!("saver-started の配信に失敗: {}", e));
    }
}

/// セーバーを終了する。動いていなければ何もしない。
pub fn stop(app: &AppHandle, reason: &str) {
    if !RUNNING.swap(false, Ordering::SeqCst) {
        return;
    }
    SETTINGS_MODE.store(false, Ordering::SeqCst);
    debug::log("rust", "info", &format!("セーバーを終了 reason={}", reason));
    close_sub_windows(app);
    if let Some(main) = app.get_webview_window("main") {
        log_if_err("main", "set_always_on_top", main.set_always_on_top(false));
        log_if_err("main", "set_fullscreen", main.set_fullscreen(false));
        log_if_err("main", "hide", main.hide());
    }
    if let Err(e) = app.emit_to("main", "saver-stopped", reason) {
        debug::log("rust", "error", &format!("saver-stopped の配信に失敗: {}", e));
    }
}

// ---- コマンド --------------------------------------------------------------

#[tauri::command]
pub async fn start_saver(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    start(&app, reason.as_deref().unwrap_or("command"), false);
    Ok(())
}

#[tauri::command]
pub async fn stop_saver(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    stop(&app, reason.as_deref().unwrap_or("command"));
    Ok(())
}

#[tauri::command]
pub fn saver_state() -> SaverState {
    SaverState {
        running: RUNNING.load(Ordering::SeqCst),
        settings_mode: SETTINGS_MODE.load(Ordering::SeqCst),
    }
}

#[tauri::command]
pub fn set_saver_config(config: SaverConfig) {
    debug::log("rust", "info", &format!("セーバー設定を受け取った: {:?}", config));
    if let Ok(mut c) = CONFIG.lock() {
        *c = config;
    }
}

/// サブモニターをすべて閉じる（マルチモニターの ON/OFF・構成変更の再展開で使う）。
#[tauri::command]
pub async fn close_sub_monitors(app: AppHandle) -> Result<usize, String> {
    Ok(close_sub_windows(&app))
}

/// サブモニターを開く。セーバーが動いていなければ何もしない（次に起動したときに作られる）。
#[tauri::command]
pub async fn open_sub_monitors(app: AppHandle) -> Result<(), String> {
    if !is_running() {
        debug::log("rust", "info", "open_sub_monitors: セーバーが動いていないので何もしない");
        return Ok(());
    }
    let main_pos = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .map(|m| *m.position());
    open_sub_windows(&app, main_pos, !SETTINGS_MODE.load(Ordering::SeqCst))
}

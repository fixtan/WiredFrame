mod debug;
mod hotkey;
mod idle;
mod monitors;
mod saver;

use std::fs;
use std::path::Path;

// タスクトレイ
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};
use tauri::{Manager, Emitter};

// フロントエンドから呼び出せるRustコマンド
#[tauri::command]
fn get_images_from_dir(dir_path: String) -> Result<Vec<String>, String> {
    let path = Path::new(&dir_path);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Directory not found: {}", dir_path));
    }

    let mut images = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries {
        if let Ok(entry) = entry {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    let ext = ext.to_lowercase();
                    if ["jpg", "jpeg", "png", "webp", "bmp"].contains(&ext.as_str()) {
                        if let Some(path_str) = p.to_str() {
                            images.push(path_str.to_string());
                        }
                    }
                }
            }
        }
    }
    Ok(images)
}

// 失敗したら握りつぶさずにログへ出す（以前は `let _ =` で捨てていた）
pub(crate) fn log_if_err(label: &str, what: &str, result: tauri::Result<()>) {
    if let Err(e) = result {
        debug::log("rust", "error", &format!("{}: {} に失敗: {}", label, what, e));
    }
}

// 🖥️ すべてのウィンドウのフルスクリーンを一括切替するコマンド
#[tauri::command]
fn set_fullscreen_all(app: tauri::AppHandle, fullscreen: bool) -> Result<(), String> {
    let windows = app.webview_windows();
    debug::log(
        "rust",
        "info",
        &format!("set_fullscreen_all({}): {} ウィンドウ", fullscreen, windows.len()),
    );
    for (label, window) in windows {
        log_if_err(&label, "set_fullscreen", window.set_fullscreen(fullscreen));
    }
    Ok(())
}


/// Windows ログイン時の自動起動が有効か（状態は OS 側のレジストリが持つ。設定ファイルには保存しない）
#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    match app.autolaunch().is_enabled() {
        Ok(v) => v,
        Err(e) => {
            debug::log("rust", "warn", &format!("自動起動の状態を取得できない: {e}"));
            false
        }
    }
}

/// Windows ログイン時の自動起動を ON/OFF する。失敗したら理由を返す
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled { manager.enable() } else { manager.disable() };
    match &result {
        Ok(()) => debug::log("rust", "info", &format!("ログイン時の自動起動を {} にした", if enabled { "ON" } else { "OFF" })),
        Err(e) => debug::log("rust", "warn", &format!("自動起動の切り替えに失敗: {e}")),
    }
    result.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    debug::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            get_images_from_dir,
            set_fullscreen_all,
            get_autostart,
            set_autostart,
            saver::open_sub_monitors,
            saver::close_sub_monitors,
            saver::start_saver,
            saver::stop_saver,
            saver::saver_state,
            saver::set_saver_config,
            debug::debug_log,
            monitors::list_monitors,
            monitors::current_monitor_info
        ])
        .setup(|app| {
            // 起動時にモニター一覧をログへ（識別方法を決めるための材料）
            monitors::log_all(app.handle(), "startup");

            // モニター構成の変化（抜き差し・配置変更）を見張る
            let watch_handle = app.handle().clone();
            std::thread::spawn(move || monitors::watch(watch_handle));

            // 無操作を見張る（設定で ON のときだけ自動起動。Windows のみ）
            let idle_handle = app.handle().clone();
            std::thread::spawn(move || idle::watch(idle_handle));
            let esc_handle = app.handle().clone();
            std::thread::spawn(move || idle::watch_esc(esc_handle));

            // トレイメニューの作成（「設定」「デバッグ表示」「終了」）
            let settings_item = MenuItem::with_id(app, "settings", "設定", true, None::<String>)?;
            let debug_item = MenuItem::with_id(app, "debug-overlay", "デバッグ表示", true, None::<String>)?;
            let start_item = MenuItem::with_id(app, "start-saver", "スクリーンセーバーを起動", true, None::<String>)?;
            let reexpand_item = MenuItem::with_id(app, "reexpand", "モニターを再展開", true, None::<String>)?;
            let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<String>)?;
            let menu = Menu::with_items(app, &[&start_item, &settings_item, &reexpand_item, &debug_item, &quit_item])?;

            // トレイアイコンの構築
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        // トレイのイベントはメインスレッドで動く。Windows ではそこでウィンドウを
                        // 作ると固まることがあるので、別タスクで実行する
                        "start-saver" => {
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                saver::start(&app, "tray", false);
                            });
                        }
                        "settings" => {
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                // 動いていなければ、設定モードで起動する（全モニターに映してパネルを出すため）。
                                // サブウィンドウは起動時に自分で「設定モードか」を確認してパネルを開く
                                saver::start(&app, "tray-settings", true);
                                // 全ウィンドウに配信。各モニターが自分用の設定パネルを開く
                                if let Err(e) = app.emit("open-settings", ()) {
                                    debug::log("rust", "error", &format!("open-settings の配信に失敗: {}", e));
                                }
                            });
                        }
                        "reexpand" => {
                            // main がサブモニターを閉じて開き直す
                            if let Err(e) = app.emit_to("main", "reexpand-monitors", ()) {
                                debug::log("rust", "error", &format!("reexpand-monitors の配信に失敗: {}", e));
                            }
                        }
                        "debug-overlay" => {
                            // 全ウィンドウに配信（emit は全宛先）。各モニターに識別用オーバーレイが出る
                            monitors::log_all(app, "tray");
                            if let Err(e) = app.emit("toggle-debug-overlay", ()) {
                                debug::log("rust", "error", &format!("toggle-debug-overlay の配信に失敗: {}", e));
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

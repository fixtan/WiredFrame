mod debug;
mod monitors;

use std::fs;
use std::path::Path;

// タスクトレイ
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};
use tauri::{Manager, Emitter, WebviewUrl, WebviewWindowBuilder, PhysicalPosition, PhysicalSize};

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
fn log_if_err(label: &str, what: &str, result: tauri::Result<()>) {
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


// 🖥️ Rust側でサブモニター用のウィンドウを正確な物理座標で生成し、フルスクリーン化する
#[tauri::command]
async fn open_sub_monitors(app: tauri::AppHandle) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let main_monitor = app
        .get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten());
    let main_pos = main_monitor.as_ref().map(|m| *m.position());

    match &main_monitor {
        Some(m) => debug::log(
            "rust",
            "info",
            &format!(
                "open_sub_monitors: main は pos=({},{}) のモニター上。ここは除外する",
                m.position().x,
                m.position().y
            ),
        ),
        None => debug::log(
            "rust",
            "warn",
            "open_sub_monitors: main のモニターを特定できない。どのモニターも除外されず、main と同じモニターにもサブウィンドウができる",
        ),
    }
    monitors::log_all(&app, "open_sub_monitors");

    for (i, m) in monitors.iter().enumerate() {
        // メインウィンドウが存在するモニターは除外
        if Some(*m.position()) == main_pos {
            debug::log("rust", "info", &format!("open_sub_monitors: #{} は main のモニターなのでスキップ", i));
            continue;
        }

        let label = format!("sub-monitor-{}", i);
        // すでに存在していればスキップ
        if app.get_webview_window(&label).is_some() {
            debug::log("rust", "info", &format!("open_sub_monitors: {} は作成済みなのでスキップ", label));
            continue;
        }

        // まずは非表示（visible: false）でウィンドウをビルド（位置ズレを防ぐため）
        let w = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .decorations(false)
            .resizable(false)
            .visible(false)
            .build()
            .map_err(|e| {
                let msg = format!("{} の作成に失敗: {}", label, e);
                debug::log("rust", "error", &msg);
                msg
            })?;

        // 物理ピクセル座標とサイズを正確に設定
        log_if_err(&label, "set_position", w.set_position(PhysicalPosition::new(m.position().x, m.position().y)));
        log_if_err(&label, "set_size", w.set_size(PhysicalSize::new(m.size().width, m.size().height)));

        // 表示させてからフルスクリーン化
        log_if_err(&label, "show", w.show());
        log_if_err(&label, "set_fullscreen", w.set_fullscreen(true));

        debug::log(
            "rust",
            "info",
            &format!(
                "open_sub_monitors: {} を作成（モニター #{} {:?} pos=({},{}) size={}x{}）",
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



#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    debug::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_images_from_dir,
            set_fullscreen_all,
            open_sub_monitors,
            debug::debug_log,
            monitors::list_monitors,
            monitors::current_monitor_info
        ])
        .setup(|app| {
            // 起動時にモニター一覧をログへ（識別方法を決めるための材料）
            monitors::log_all(app.handle(), "startup");

            // トレイメニューの作成（「設定」「デバッグ表示」「終了」）
            let settings_item = MenuItem::with_id(app, "settings", "設定", true, None::<String>)?;
            let debug_item = MenuItem::with_id(app, "debug-overlay", "デバッグ表示", true, None::<String>)?;
            let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<String>)?;
            let menu = Menu::with_items(app, &[&settings_item, &debug_item, &quit_item])?;

            // トレイアイコンの構築
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "settings" => {
                            let _ = app.emit_to("main", "open-settings", ());
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

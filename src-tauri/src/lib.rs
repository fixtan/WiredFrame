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

// 🖥️ すべてのウィンドウのフルスクリーンを一括切替するコマンド
#[tauri::command]
fn set_fullscreen_all(app: tauri::AppHandle, fullscreen: bool) -> Result<(), String> {
    for (_, window) in app.webview_windows() {
        let _ = window.set_fullscreen(fullscreen);
    }
    Ok(())
}


// 🖥️ Rust側でサブモニター用のウィンドウを正確な物理座標で生成し、フルスクリーン化する
#[tauri::command]
async fn open_sub_monitors(app: tauri::AppHandle) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let main_pos = app.get_webview_window("main")
        .and_then(|w| w.current_monitor().ok().flatten())
        .map(|m| *m.position());

    for (i, m) in monitors.iter().enumerate() {
        // メインウィンドウが存在するモニターは除外
        if Some(*m.position()) == main_pos {
            continue;
        }

        let label = format!("sub-monitor-{}", i);
        // すでに存在していればスキップ
        if app.get_webview_window(&label).is_some() {
            continue;
        }

        // まずは非表示（visible: false）でウィンドウをビルド（位置ズレを防ぐため）
        let w = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .decorations(false)
            .resizable(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;

        // 物理ピクセル座標とサイズを正確に設定
        let _ = w.set_position(PhysicalPosition::new(m.position().x, m.position().y));
        let _ = w.set_size(PhysicalSize::new(m.size().width, m.size().height));

        // 表示させてからフルスクリーン化
        let _ = w.show();
        let _ = w.set_fullscreen(true);
    }
    Ok(())
}



#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_images_from_dir,
            set_fullscreen_all,
            open_sub_monitors
        ])
        .setup(|app| {
            // トレイメニューの作成（「設定」と「終了」）
            let settings_item = MenuItem::with_id(app, "settings", "設定", true, None::<String>)?;
            let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<String>)?;
            let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;

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

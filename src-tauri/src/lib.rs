use std::fs;
use std::path::Path;

// タスクトレイ
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};
use tauri::{Manager, Emitter}; // ← Emitter を追加！

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_images_from_dir])
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
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit::<()>("open-settings", ());
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

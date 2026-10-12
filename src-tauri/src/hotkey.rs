//! 起動ホットキー（ロードマップ 3.2）。`tauri-plugin-global-shortcut` で 1 つだけ登録する。

use std::sync::Mutex;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{debug, saver};

/// 登録に成功した最後のホットキー（同じ指定で何度も登録し直さないため）。
static APPLIED: Mutex<Option<String>> = Mutex::new(None);

/// ホットキーを登録する。空文字なら解除する。失敗したら理由を返す（ログにも出す）。
pub fn apply(app: &AppHandle, accel: &str) -> Result<(), String> {
    let accel = accel.trim();
    if let Ok(applied) = APPLIED.lock() {
        if applied.as_deref() == Some(accel) {
            return Ok(());
        }
    }

    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| format!("ホットキーの解除に失敗: {}", e))?;
    if let Ok(mut applied) = APPLIED.lock() {
        *applied = None;
    }
    if accel.is_empty() {
        debug::log("rust", "info", "ホットキーを解除した");
        if let Ok(mut applied) = APPLIED.lock() {
            *applied = Some(String::new());
        }
        return Ok(());
    }

    let shortcut: Shortcut = accel.parse().map_err(|e| {
        let msg = format!("ホットキー「{}」を解釈できない: {}", accel, e);
        debug::log("rust", "error", &msg);
        msg
    })?;

    let handle = app.clone();
    gs.on_shortcut(shortcut, move |_app, _sc, event| {
        if event.state() == ShortcutState::Pressed {
            let handle = handle.clone();
            // ウィンドウを作るので、イベントの処理スレッドでは直接やらない
            tauri::async_runtime::spawn(async move {
                saver::start(&handle, "hotkey", false);
            });
        }
    })
    .map_err(|e| {
        let msg = format!("ホットキー「{}」を登録できない（他のアプリが使っているかもしれない）: {}", accel, e);
        debug::log("rust", "error", &msg);
        msg
    })?;

    debug::log("rust", "info", &format!("ホットキーを登録した: {}", accel));
    if let Ok(mut applied) = APPLIED.lock() {
        *applied = Some(accel.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Shortcut;

    /// フロントの設定パネルが作る形式の文字列を、ライブラリが解釈できること。
    #[test]
    fn panel_formats_parse() {
        for s in [
            "Ctrl+Alt+S",
            "Ctrl+Shift+Alt+Z",
            "Ctrl+Alt+1",
            "Ctrl+Alt+Space",
            "Ctrl+Alt+Up",
            "Ctrl+Alt+PageDown",
            "Ctrl+Alt+Home",
            "Ctrl+Alt+Insert",
            "Super+Shift+W",
            "F9",
            "Alt+F12",
        ] {
            assert!(s.parse::<Shortcut>().is_ok(), "{s} を解釈できない");
        }
    }

    #[test]
    fn garbage_is_rejected() {
        assert!("Ctrl+Alt+".parse::<Shortcut>().is_err());
        assert!("Ctrl+Alt+Hoge".parse::<Shortcut>().is_err());
    }
}

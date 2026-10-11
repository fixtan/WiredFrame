//! デバッグログ基盤。
//!
//! 複数ウィンドウ（main + サブモニター）のログを、Rust を起動したターミナル 1 か所に集める。
//! 各ウィンドウの DevTools を開かなくても、どのウィンドウで何が起きたかがラベル付きで見える。
//!
//! 出力形式: `[  12.345s] WARN  [sub-monitor-2] メッセージ`
//! 経過秒は `init()` からの時間。時刻ではなく経過時間にしているのは、
//! ウィンドウ間の発生順を読み取りやすくするため。

use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();

/// アプリ起動直後に 1 回呼ぶ。経過時間の基準点を決める。
pub fn init() {
    START.get_or_init(Instant::now);
}

/// ターミナルにログを 1 件出す。`label` はウィンドウのラベルか `rust`。
pub fn log(label: &str, level: &str, message: &str) {
    let elapsed = START.get_or_init(Instant::now).elapsed().as_secs_f64();
    println!(
        "[{:9.3}s] {:<5} [{}] {}",
        elapsed,
        level.to_uppercase(),
        label,
        message
    );
}

/// フロントエンドからのログ転送用コマンド。
#[tauri::command]
pub fn debug_log(label: String, level: String, message: String) {
    log(&label, &level, &message);
}

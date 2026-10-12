//! モニター情報の取得（設計メモの Step 1: モニター識別の確認用）。
//!
//! まだ「どう識別するか」は決めていない。判断材料を集めるために、
//! `available_monitors()` が返す情報を `MonitorInfo` にそろえて、ログと画面に出す。
//!
//! 事実（tao 0.37 のソースより）:
//! - `name` は Windows では GDI のデバイス名（例 `\\.\DISPLAY3`）。
//! - 列挙順は `EnumDisplayMonitors` の順で、Windows の設定アプリの番号 1〜6 と一致する保証はない。

use serde::Serialize;
use tauri::{AppHandle, Manager, Monitor, WebviewWindow};

use crate::debug;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// `available_monitors()` の列挙順（0 始まり）。
    pub index: usize,
    /// Windows では GDI デバイス名（例 `\\.\DISPLAY3`）。
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    /// タスクバーを除いた作業領域。
    pub work_x: i32,
    pub work_y: i32,
    pub work_width: u32,
    pub work_height: u32,
    pub is_primary: bool,
}

fn to_info(index: usize, m: &Monitor, primary: Option<&Monitor>) -> MonitorInfo {
    let work = m.work_area();
    MonitorInfo {
        index,
        name: m.name().cloned(),
        x: m.position().x,
        y: m.position().y,
        width: m.size().width,
        height: m.size().height,
        scale_factor: m.scale_factor(),
        work_x: work.position.x,
        work_y: work.position.y,
        work_width: work.size.width,
        work_height: work.size.height,
        is_primary: primary
            .is_some_and(|p| p.position() == m.position() && p.size() == m.size()),
    }
}

/// モニター構成の「指紋」。名前・位置・サイズを並べ替えて連結する（列挙順が変わっても同じになる）。
fn signature(app: &AppHandle) -> Option<String> {
    let mut v: Vec<String> = collect(app)
        .ok()?
        .iter()
        .map(|m| format!("{}|{},{}|{}x{}", m.name.as_deref().unwrap_or("?"), m.x, m.y, m.width, m.height))
        .collect();
    v.sort();
    Some(v.join(";"))
}

/// モニター構成の変化を見張る（別スレッドで動かす）。
/// 3 秒おきに調べ、同じ変化を 2 回続けて見たときだけ `monitors-changed` を main に送る
/// （抜き差しの途中で何度も構成が変わるのに反応しないため）。
pub fn watch(app: AppHandle) {
    use tauri::Emitter;
    let mut baseline = signature(&app);
    let mut candidate: Option<String> = None;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let now = signature(&app);
        if now.is_none() || now == baseline {
            candidate = None;
            continue;
        }
        if now == candidate {
            debug::log("rust", "info", "モニター構成が変わった。monitors-changed を main に送る");
            log_all(&app, "monitors-changed");
            baseline = now;
            candidate = None;
            if let Err(e) = app.emit_to("main", "monitors-changed", ()) {
                debug::log("rust", "error", &format!("monitors-changed の配信に失敗: {}", e));
            }
        } else {
            candidate = now;
        }
    }
}

/// 接続中の全モニターを列挙順で返す。
pub fn collect(app: &AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(i, m)| to_info(i, m, primary.as_ref()))
        .collect())
}

/// ターミナル表示用の表。
pub fn format_table(list: &[MonitorInfo]) -> String {
    list.iter()
        .map(|m| {
            format!(
                "  #{} {:<16} pos=({},{}) size={}x{} scale={:.2} work={}x{}@({},{}){}",
                m.index,
                m.name.as_deref().unwrap_or("(no name)"),
                m.x,
                m.y,
                m.width,
                m.height,
                m.scale_factor,
                m.work_width,
                m.work_height,
                m.work_x,
                m.work_y,
                if m.is_primary { "  [primary]" } else { "" }
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 全モニターの一覧をターミナルに出す。`tag` は呼び出し元の目印。
pub fn log_all(app: &AppHandle, tag: &str) {
    match collect(app) {
        Ok(list) => debug::log(
            "rust",
            "info",
            &format!(
                "monitors ({}): {} 台\n{}",
                tag,
                list.len(),
                format_table(&list)
            ),
        ),
        Err(e) => debug::log("rust", "error", &format!("monitors ({}): 取得に失敗: {}", tag, e)),
    }
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    collect(&app)
}

/// 呼び出したウィンドウが今いるモニターを返す。
/// 位置とサイズが一致するモニターを `available_monitors()` から探す。見つからなければ `None`。
#[tauri::command]
pub fn current_monitor_info(window: WebviewWindow) -> Result<Option<MonitorInfo>, String> {
    let Some(current) = window.current_monitor().map_err(|e| e.to_string())? else {
        debug::log(
            window.label(),
            "warn",
            "current_monitor() が None（ウィンドウがどのモニターにも属していない）",
        );
        return Ok(None);
    };

    let list = collect(window.app_handle())?;
    let found = list.into_iter().find(|m| {
        m.x == current.position().x
            && m.y == current.position().y
            && m.width == current.size().width
            && m.height == current.size().height
    });

    if found.is_none() {
        debug::log(
            window.label(),
            "warn",
            "current_monitor() の結果が available_monitors() のどれとも一致しない",
        );
    }
    Ok(found)
}

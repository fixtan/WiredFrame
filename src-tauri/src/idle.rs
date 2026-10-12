//! 無操作の検知と自動起動（ロードマップ 3.3）。
//!
//! Windows の `GetLastInputInfo`（システム全体で最後にキー・マウス操作があった時刻）を
//! 1 秒おきに読む。フックは使わない。Windows 以外では何もしない。
//!
//! - セーバーが動いておらず、設定で ON で、無操作が指定時間を超えたら、自動起動する。
//! - 自動起動したセーバーは、設定（`idle_exit_on_input`）が ON なら、起動後に新しい操作があったら終了する。
//!   OFF（既定）なら、ESC だけで終了する（マウスで画面を回したりできる）。
//!   自動起動ではウィンドウにキーボードのフォーカスが来ないことがあるので、ESC は `watch_esc` が
//!   システム全体で見張る（`GetAsyncKeyState`）。
//!   手動起動（ホットキー・トレイ）は、ESC だけで終了する（画面側のキー入力で止まる）。
//! - 動画再生中などは判断しない（操作がなければ起動する。Windows の標準のスクリーンセーバーとは違う）。

use tauri::AppHandle;

use crate::{debug, saver};

/// 起動直後のこの時間内の操作は無視する（起動操作そのものや、起動直後の手の動きで即終了しないため）。
const GRACE_MS: u32 = 2000;

/// (今の GetTickCount, 最後の入力時刻の GetTickCount)。取れなければ None。
#[cfg(windows)]
fn ticks() -> Option<(u32, u32)> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: info は有効な LASTINPUTINFO で、cbSize を設定済み。
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if ok == 0 {
        return None;
    }
    // SAFETY: 引数なしの単純な API。
    let now = unsafe { GetTickCount() };
    Some((now, info.dwTime))
}

#[cfg(not(windows))]
fn ticks() -> Option<(u32, u32)> {
    None
}

/// ESC キーが今押されているか（どのウィンドウにフォーカスがあっても分かる）。
#[cfg(windows)]
fn esc_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE};
    // SAFETY: 仮想キーコードを渡すだけの単純な API。最上位ビットが「今押されている」。
    let state = unsafe { GetAsyncKeyState(VK_ESCAPE as i32) };
    (state as u16) & 0x8000 != 0
}

#[cfg(not(windows))]
fn esc_down() -> bool {
    false
}

/// 無操作の長さ（ミリ秒）。GetTickCount は約 49.7 日で一周するので wrapping で引く。
fn idle_ms(now: u32, last_input: u32) -> u32 {
    now.wrapping_sub(last_input)
}

/// `since`（起動時刻）より `grace_ms` を超えて後に入力があったか。
fn input_after(last_input: u32, since: u32, grace_ms: u32) -> bool {
    (last_input.wrapping_sub(since) as i32) > grace_ms as i32
}

/// 無操作を見張る（別スレッドで動かす）。
pub fn watch(app: AppHandle) {
    if ticks().is_none() {
        debug::log("rust", "info", "無操作の検知は、この OS では使えない（Windows のみ）。自動起動は無効");
        return;
    }
    debug::log("rust", "info", "無操作の監視を開始");
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let Some((now, last)) = ticks() else { continue };

        if saver::is_running() {
            // 自動起動したセーバーは、設定が ON なら、起動後の操作で終了する（OFF なら ESC だけ。watch_esc が見張る）
            if let Some(since) = saver::auto_started_at() {
                if saver::config().idle_exit_on_input && input_after(last, since, GRACE_MS) {
                    saver::stop(&app, "idle-input");
                }
            }
            continue;
        }

        let cfg = saver::config();
        if !cfg.idle_enabled {
            continue;
        }
        let threshold_ms = u64::from(cfg.idle_minutes.max(1)) * 60_000;
        if u64::from(idle_ms(now, last)) >= threshold_ms {
            debug::log(
                "rust",
                "info",
                &format!("無操作が {} 分続いたのでセーバーを自動起動する", cfg.idle_minutes),
            );
            saver::start_auto(&app, now);
        }
    }
}

/// 自動起動したセーバーを、ESC で終了させる（設定で「操作で終了」が OFF のとき）。
/// 0.05 秒おきに ESC の状態を見る。起動直後の猶予内は無視する。
pub fn watch_esc(app: AppHandle) {
    if ticks().is_none() {
        return;
    }
    loop {
        std::thread::sleep(std::time::Duration::from_millis(50));
        if !saver::is_running() {
            continue;
        }
        let Some(since) = saver::auto_started_at() else { continue };
        if saver::config().idle_exit_on_input {
            continue; // 操作での終了が ON のときは、watch が見る
        }
        let Some((now, _)) = ticks() else { continue };
        if now.wrapping_sub(since) > GRACE_MS && esc_down() {
            saver::stop(&app, "esc-global");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_ms_wraps_around() {
        assert_eq!(idle_ms(5_000, 1_000), 4_000);
        // GetTickCount が一周した直後
        assert_eq!(idle_ms(500, u32::MAX - 499), 1_000);
    }

    #[test]
    fn input_after_respects_grace() {
        let since = 100_000;
        assert!(!input_after(since - 10, since, GRACE_MS)); // 起動前の操作
        assert!(!input_after(since + 1_000, since, GRACE_MS)); // 猶予内
        assert!(input_after(since + 2_500, since, GRACE_MS)); // 猶予後
    }

    #[test]
    fn input_after_wraps_around() {
        let since = u32::MAX - 1_000;
        assert!(input_after(2_500, since, GRACE_MS)); // 起動後に一周して操作
        assert!(!input_after(since.wrapping_sub(5), since, GRACE_MS));
    }
}

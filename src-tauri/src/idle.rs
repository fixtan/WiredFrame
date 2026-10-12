//! 無操作の検知と自動起動（ロードマップ 3.3）。
//!
//! Windows の `GetLastInputInfo`（システム全体で最後にキー・マウス操作があった時刻）を
//! 1 秒おきに読む。フックは使わない。Windows 以外では何もしない。
//!
//! - セーバーが動いておらず、設定で ON で、無操作が指定時間を超えたら、自動起動する。
//! - 自動起動したセーバーは、起動後に新しい操作があったら終了する（ESC でなくてもよい）。
//!   手動起動（ホットキー・トレイ）は、ESC だけで終了する。
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
            // 自動起動したセーバーは、起動後の操作で終了する
            if let Some(since) = saver::auto_started_at() {
                if input_after(last, since, GRACE_MS) {
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

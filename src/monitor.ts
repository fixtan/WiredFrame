// src/monitor.ts
//
// モニター情報の取得と、設定の保存キーの生成。
// Rust 側 `monitors::MonitorInfo`（src-tauri/src/monitors.rs）と対応する。

import { invoke } from '@tauri-apps/api/core';

/** Rust 側 `monitors::MonitorInfo` と対応（camelCase） */
export type MonitorInfo = {
  index: number;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  workX: number;
  workY: number;
  workWidth: number;
  workHeight: number;
  isPrimary: boolean;
};

/** このウィンドウが今いるモニター。特定できなければ null。 */
export async function fetchCurrentMonitor(): Promise<MonitorInfo | null> {
  return invoke<MonitorInfo | null>('current_monitor_info');
}

/**
 * 設定の保存キー。Windows のデバイス名 + 解像度（例 `\\.\DISPLAY12|1920x1080`）。
 *
 * 決め方の経緯（docs/multi-monitor-design.md）:
 * - idx は抜き差しで変わりうる。位置は配置を変えると変わる。
 * - name は連番でなく（DISPLAY1,2,3,4,12,13）、設定アプリの番号とは別物だが、各モニターで区別できる。
 * - 完全に安定する方法はない。モニター構成が変わって設定が合わなくなったら、設定し直す前提。
 */
export function monitorKeyOf(m: MonitorInfo | null): string {
  if (!m) return 'unknown';
  const id = m.name ?? `idx${m.index}`;
  return `${id}|${m.width}x${m.height}`;
}

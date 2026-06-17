#[cfg(not(target_os = "macos"))]
use tauri::{AppHandle, Rect, Runtime};

#[cfg(not(target_os = "macos"))]
pub fn toggle_tray_menu<R: Runtime>(_app: &AppHandle<R>, _rect: Rect) {}

#[cfg(target_os = "macos")]
use tauri::{AppHandle, Rect, Runtime};

#[cfg(target_os = "macos")]
pub fn toggle_tray_menu<R: Runtime>(app: &AppHandle<R>, _rect: Rect) {
    if let Err(err) = crate::modules::floating_card_window::show_main_window(app) {
        crate::modules::logger::log_warn(&format!("[Tray] macOS 显示主窗口失败: {}", err));
    }
}
//! Codex-only system tray module.

#[cfg(target_os = "macos")]
use crate::modules::config::TrayIconStyle;
use crate::modules::logger;

#[cfg(target_os = "macos")]
use tauri::image::Image;
#[cfg(not(target_os = "macos"))]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Runtime,
};

pub const TRAY_ID: &str = "main-tray";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum PlatformId {
    Codex,
}

impl PlatformId {
    pub(crate) fn default_order() -> [Self; 1] {
        [Self::Codex]
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value {
            crate::modules::tray_layout::PLATFORM_CODEX => Some(Self::Codex),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        crate::modules::tray_layout::PLATFORM_CODEX
    }

    pub(crate) fn nav_target(self) -> &'static str {
        "codex"
    }
}

#[cfg(target_os = "macos")]
fn tray_icon_for_style<'a, R: Runtime>(
    app: &'a tauri::AppHandle<R>,
    style: TrayIconStyle,
) -> Result<(Image<'a>, bool), tauri::Error> {
    match style {
        TrayIconStyle::Template => Ok((
            Image::from_bytes(include_bytes!("../../icons/tray/status-template.png"))?,
            true,
        )),
        TrayIconStyle::Color => Ok((
            app.default_window_icon()
                .expect("default window icon should exist")
                .clone(),
            false,
        )),
    }
}

#[cfg(target_os = "macos")]
pub fn apply_tray_icon_style<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let style = crate::modules::config::get_user_config().tray_icon_style;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let (icon, template) = tray_icon_for_style(app, style).map_err(|err| err.to_string())?;
        tray.set_icon(Some(icon)).map_err(|err| err.to_string())?;
        tray.set_icon_as_template(template)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn apply_tray_icon_style<R: Runtime>(_app: &tauri::AppHandle<R>) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn build_tray_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
    let show_window = MenuItem::with_id(app, "show_window", "显示主窗口", true, None::<&str>)?;
    let codex = MenuItem::with_id(app, "codex", "Codex", true, None::<&str>)?;
    let codex_api_service = MenuItem::with_id(
        app,
        "codex_api_service",
        "Codex API Service",
        true,
        None::<&str>,
    )?;
    let refresh = MenuItem::with_id(app, "refresh_quota", "刷新 Codex", true, None::<&str>)?;
    let floating_card = MenuItem::with_id(app, "floating_card", "显示悬浮卡片", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &show_window,
            &codex,
            &codex_api_service,
            &refresh,
            &PredefinedMenuItem::separator(app)?,
            &floating_card,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn navigate<R: Runtime>(app: &tauri::AppHandle<R>, page: &str) {
    if let Err(err) = crate::modules::floating_card_window::show_main_window_and_navigate(app, page) {
        logger::log_warn(&format!("[Tray] 打开页面失败: page={}, error={}", page, err));
    }
}

fn handle_menu_event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "show_window" => {
            if let Err(err) = crate::modules::floating_card_window::show_main_window(app) {
                logger::log_warn(&format!("[Tray] 显示主窗口失败: {}", err));
            }
        }
        "codex" => navigate(app, "codex"),
        "codex_api_service" => navigate(app, "codex-api-service"),
        "refresh_quota" => {
            let _ = app.emit("tray:refresh_quota", ());
        }
        "floating_card" => {
            let _ = crate::modules::floating_card_window::show_floating_card_window(app, true);
        }
        "settings" => navigate(app, "settings"),
        "quit" => app.exit(0),
        _ => {}
    }
}

fn handle_tray_event<R: Runtime>(tray: &TrayIcon<R>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        if let Err(err) = crate::modules::floating_card_window::show_main_window(tray.app_handle()) {
            logger::log_warn(&format!("[Tray] 恢复主窗口失败: {}", err));
        }
    }
}

pub fn update_tray_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let menu = build_tray_menu(app).map_err(|err| err.to_string())?;
        tray.set_menu(Some(menu)).map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn create_tray_skeleton<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    create_tray(app)
}

pub fn create_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).on_tray_icon_event(handle_tray_event);

    #[cfg(not(target_os = "macos"))]
    {
        let menu = build_tray_menu(app).map_err(|err| err.to_string())?;
        builder = builder.menu(&menu).show_menu_on_left_click(false);
    }

    builder
        .on_menu_event(handle_menu_event)
        .icon(
            app.default_window_icon()
                .expect("default window icon should exist")
                .clone(),
        )
        .build(app)
        .map_err(|err| err.to_string())?;

    apply_tray_icon_style(app)?;
    Ok(())
}
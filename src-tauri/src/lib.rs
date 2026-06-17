mod commands;
pub mod error;
mod models;
mod modules;
mod utils;

use modules::config::CloseWindowBehavior;
use modules::logger;
use std::sync::OnceLock;
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri::RunEvent;
use tauri::WindowEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tracing::info;

/// 全局 AppHandle 存储
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// 获取全局 AppHandle
pub fn get_app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn raise_process_file_descriptor_limit() {
    const TARGET_NOFILE_LIMIT: libc::rlim_t = 4096;

    unsafe {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
            logger::log_warn(&format!(
                "[Startup] 读取进程文件句柄上限失败: {}",
                std::io::Error::last_os_error()
            ));
            return;
        }

        let target = if limit.rlim_max == libc::RLIM_INFINITY {
            TARGET_NOFILE_LIMIT
        } else {
            TARGET_NOFILE_LIMIT.min(limit.rlim_max)
        };
        if target <= limit.rlim_cur || target == 0 {
            return;
        }

        let previous = limit.rlim_cur;
        limit.rlim_cur = target;
        if libc::setrlimit(libc::RLIMIT_NOFILE, &limit) == 0 {
            logger::log_info(&format!(
                "[Startup] 已提升进程文件句柄软限制: {} -> {}",
                previous, target
            ));
        } else {
            logger::log_warn(&format!(
                "[Startup] 提升进程文件句柄软限制失败: {} -> {}, error={}",
                previous,
                target,
                std::io::Error::last_os_error()
            ));
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn raise_process_file_descriptor_limit() {}

#[cfg(target_os = "macos")]
fn apply_macos_activation_policy(app: &tauri::AppHandle) {
    let config = modules::config::get_user_config();
    let (policy, dock_visible, policy_label) = if config.hide_dock_icon {
        (ActivationPolicy::Accessory, false, "hidden")
    } else {
        (ActivationPolicy::Regular, true, "visible")
    };

    if let Err(err) = app.set_activation_policy(policy) {
        logger::log_warn(&format!("[Window] 设置 macOS 激活策略失败: {}", err));
        return;
    }

    if let Err(err) = app.set_dock_visibility(dock_visible) {
        logger::log_warn(&format!("[Window] 设置 macOS Dock 可见性失败: {}", err));
    }

    if dock_visible {
        let _ = app.show();
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    }

    info!("[Window] 已应用 macOS Dock 图标策略: {}", policy_label);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logger::init_logger();
    raise_process_file_descriptor_limit();
    // 启动时先加载一次配置，确保进程级代理环境与用户设置同步。
    let _ = modules::config::get_user_config();

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            logger::log_info("[Linux] 设置 WEBKIT_DISABLE_DMABUF_RENDERER=1");
        }
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            logger::log_info(&format!(
                "[SingleInstance] 收到唤起请求: arg_count={}",
                args.len()
            ));
            let handled = modules::external_import::handle_external_import_args(
                app,
                &args,
                "single-instance",
            );
            logger::log_info(&format!(
                "[SingleInstance] 外部导入处理结果: handled={}",
                handled
            ));
            if handled {
                return;
            }
            if let Err(err) = modules::floating_card_window::show_main_window(app) {
                logger::log_warn(&format!("[Window] 单实例唤起恢复主窗口失败: {}", err));
            }
        }))
        .setup(|app| {
            info!("Cockpit Tools 启动...");
            let current_exe = std::env::current_exe()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|err| format!("unknown: {}", err));
            let build_mode = if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            };
            logger::log_info(&format!(
                "[Startup] 启动诊断: marker=tray-diagnostics-v1, version={}, mode={}, exe={}",
                env!("CARGO_PKG_VERSION"),
                build_mode,
                current_exe
            ));

            // 存储全局 AppHandle
            let _ = APP_HANDLE.set(app.handle().clone());

            // 启动时清理 WebKit LocalStorage WAL，防止无限膨胀
            std::thread::spawn(|| {
                modules::webkit_cache_maintenance::checkpoint_webkit_localstorage();
            });

            // 初始化桌面插件
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_process::init())?;
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None::<Vec<&'static str>>,
                ))?;
                info!("[Desktop] Process + Autostart 插件已初始化");
            }

            // 启动时同步设置合并（移至后台线程，不阻塞窗口显示）
            std::thread::spawn(|| {
                let current_config = modules::config::get_user_config();
                if let Some(merged_language) = modules::sync_settings::merge_setting_on_startup(
                    "language",
                    &current_config.language,
                    None,
                ) {
                    info!(
                        "[SyncSettings] 启动时合并语言设置: {} -> {}",
                        current_config.language, merged_language
                    );
                    let new_config = modules::config::UserConfig {
                        language: merged_language,
                        ..current_config
                    };
                    if let Err(e) = modules::config::save_user_config(&new_config) {
                        logger::log_error(&format!("[SyncSettings] 保存合并后的配置失败: {}", e));
                    }
                }
            });

            // 启动 WebSocket 服务（使用 Tauri 的 async runtime）
            tauri::async_runtime::spawn(async {
                modules::websocket::start_server().await;
            });

            // 启动网页查询服务（网络服务配置中的独立模块）
            tauri::async_runtime::spawn(async {
                modules::web_report::start_server().await;
            });

            tauri::async_runtime::spawn(async {
                modules::codex_local_access::restore_local_access_gateway().await;
            });

            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    modules::codex_oauth::restore_pending_oauth_listener(app_handle);
                });
            }

            modules::codex_wakeup_scheduler::ensure_started(app.handle().clone());
            modules::codex_wakeup_scheduler::trigger_startup_tasks_if_needed(app.handle().clone());

            #[cfg(target_os = "macos")]
            apply_macos_activation_policy(&app.handle());

            #[cfg(any(windows, target_os = "linux"))]
            if let Err(err) = app.deep_link().register_all() {
                logger::log_warn(&format!("[DeepLink] register_all 失败: {}", err));
            } else {
                logger::log_info("[DeepLink] register_all 已完成");
            }

            {
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    let args: Vec<String> = urls.iter().map(|url| url.to_string()).collect();
                    logger::log_info(&format!(
                        "[DeepLink] 收到 on_open_url 事件: url_count={}, urls={:?}",
                        args.len(),
                        args
                    ));
                    let handled = modules::external_import::handle_external_import_args(
                        &app_handle,
                        &args,
                        "deep-link-open-url",
                    );
                    logger::log_info(&format!(
                        "[DeepLink] on_open_url 外部导入处理结果: handled={}",
                        handled
                    ));
                });
            }

            match app.deep_link().get_current() {
                Ok(Some(urls)) => {
                    let args: Vec<String> = urls.iter().map(|url| url.to_string()).collect();
                    logger::log_info(&format!(
                        "[DeepLink] 启动时 get_current 命中: url_count={}, urls={:?}",
                        args.len(),
                        args
                    ));
                    let handled = modules::external_import::handle_external_import_args(
                        &app.handle(),
                        &args,
                        "deep-link-current",
                    );
                    logger::log_info(&format!(
                        "[DeepLink] get_current 外部导入处理结果: handled={}",
                        handled
                    ));
                }
                Ok(None) => {
                    logger::log_info("[DeepLink] 启动时 get_current: empty");
                }
                Err(err) => {
                    logger::log_warn(&format!("[DeepLink] get_current 失败: {}", err));
                }
            }

            // 创建骨架托盘（无账号文件 I/O，秒出）
            if let Err(e) = modules::tray::create_tray_skeleton(app.handle()) {
                logger::log_error(&format!("[Tray] 创建骨架托盘失败: {}", e));
            }

            #[cfg(target_os = "macos")]
            {
                let tray_app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    if let Err(err) = modules::tray::apply_tray_icon_style(&tray_app_handle) {
                        logger::log_warn(&format!(
                            "[Tray] macOS 启动后重应用菜单栏图标样式失败: {}",
                            err
                        ));
                    }
                });
            }

            // 后台线程加载完整托盘菜单（含账号数据）
            let tray_app_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = modules::tray::update_tray_menu(&tray_app_handle) {
                    logger::log_error(&format!("[Tray] 后台更新托盘菜单失败: {}", e));
                }
            });

            if let Err(err) =
                modules::floating_card_window::show_floating_card_window_on_startup(&app.handle())
            {
                logger::log_warn(&format!("[FloatingCard] 启动时显示悬浮卡片失败: {}", err));
            }

            let startup_args: Vec<String> = std::env::args().collect();
            logger::log_info(&format!("[Startup] 启动参数数量: {}", startup_args.len()));
            let startup_external_import_handled =
                modules::external_import::handle_external_import_args(
                    &app.handle(),
                    &startup_args,
                    "startup",
                );
            logger::log_info(&format!(
                "[Startup] 外部导入处理结果: handled={}",
                startup_external_import_handled
            ));

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if window.label() != "main" {
                    return;
                }
                let config = modules::config::get_user_config();

                match config.close_behavior {
                    CloseWindowBehavior::Minimize => {
                        api.prevent_close();
                        let _ = window.hide();
                        info!("[Window] 窗口已最小化到托盘");
                    }
                    CloseWindowBehavior::Quit => {
                        info!("[Window] 用户选择退出应用");
                        window.app_handle().exit(0);
                    }
                    CloseWindowBehavior::Ask => {
                        api.prevent_close();
                        let _ = window.emit("window:close_requested", ());
                        info!("[Window] 等待用户选择关闭行为");
                    }
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::data_transfer::data_transfer_get_user_config,
            commands::data_transfer::data_transfer_apply_user_config,
            commands::data_transfer::data_transfer_get_instance_store,
            commands::data_transfer::data_transfer_replace_instance_store,
            // System Commands
            commands::system::open_data_folder,
            commands::system::save_text_file,
            commands::system::get_downloads_dir,
            commands::system::get_auto_backup_settings,
            commands::system::save_auto_backup_settings,
            commands::system::update_auto_backup_last_run,
            commands::system::write_auto_backup_file,
            commands::system::read_auto_backup_file,
            commands::system::copy_auto_backup_file,
            commands::system::list_auto_backup_files,
            commands::system::delete_auto_backup_file,
            commands::system::cleanup_auto_backup_files,
            commands::system::open_auto_backup_dir,
            commands::system::get_webdav_sync_settings,
            commands::system::save_webdav_sync_settings,
            commands::system::test_webdav_sync_connection,
            commands::system::upload_auto_backup_to_webdav,
            commands::system::list_webdav_backup_files,
            commands::system::read_webdav_backup_file,
            commands::system::delete_webdav_backup_file,
            commands::system::get_network_config,
            commands::system::save_network_config,
            commands::system::get_general_config,
            commands::system::get_available_terminals,
            commands::system::save_general_config,
            commands::system::save_tray_platform_layout,
            commands::system::set_app_path,
            commands::system::set_codex_launch_on_switch,
            commands::system::set_codex_local_access_entry_visible,
            commands::system::detect_app_path,
            commands::system::handle_window_close,
            commands::system::show_floating_card_window,
            commands::system::show_instance_floating_card_window,
            commands::system::get_floating_card_context,
            commands::system::hide_floating_card_window,
            commands::system::hide_current_floating_card_window,
            commands::system::set_floating_card_always_on_top,
            commands::system::set_current_floating_card_window_always_on_top,
            commands::system::set_floating_card_confirm_on_close,
            commands::system::save_floating_card_position,
            commands::system::show_main_window_and_navigate,
            commands::system::external_import_take_pending,
            commands::system::external_import_fetch_import_url,
            commands::system::open_folder,
            commands::system::delete_corrupted_file,
            // Logs Commands
            commands::logs::logs_get_snapshot,
            commands::logs::logs_open_log_directory,
            // Announcement Commands
            commands::announcement::announcement_get_state,
            commands::announcement::announcement_mark_as_read,
            commands::announcement::announcement_mark_all_as_read,
            commands::announcement::announcement_force_refresh,
            commands::announcement::announcement_get_top_right_ad,
            commands::announcement::announcement_get_sponsor_module,
            commands::announcement::announcement_force_refresh_sponsor_module,
            commands::remote_config::remote_config_get_state,
            commands::remote_config::remote_config_force_refresh,
            // Group Commands
            commands::group::get_group_settings,
            commands::group::save_group_settings,
            commands::group::set_model_group,
            commands::group::remove_model_group,
            commands::group::set_group_name,
            commands::group::delete_group,
            commands::group::update_group_order,
            commands::group::get_display_groups,
            // Codex Commands
            commands::codex::list_codex_accounts,
            commands::codex::get_current_codex_account,
            commands::codex::get_codex_config_toml_path,
            commands::codex::open_codex_config_toml,
            commands::codex::get_codex_quick_config,
            commands::codex::save_codex_quick_config,
            commands::codex::get_codex_app_speed_config,
            commands::codex::save_codex_app_speed,
            commands::codex::get_codex_api_service_app_speed_config,
            commands::codex::save_codex_api_service_app_speed,
            commands::codex::update_codex_account_app_speed,
            commands::codex::refresh_codex_account_profile,
            commands::codex::switch_codex_account,
            commands::codex::delete_codex_account,
            commands::codex::delete_codex_accounts,
            commands::codex::import_codex_from_local,
            commands::codex::import_codex_from_json,
            commands::codex::export_codex_accounts,
            commands::codex::import_codex_from_files,
            commands::codex::start_codex_batch_import_from_files,
            commands::codex::cancel_codex_batch_import,
            commands::codex::resume_codex_batch_import,
            commands::codex::get_codex_batch_import_preview,
            commands::codex::confirm_codex_batch_import,
            commands::codex::refresh_codex_quota,
            commands::codex::refresh_codex_subscription_info,
            commands::codex::refresh_all_codex_quotas,
            commands::codex::refresh_current_codex_quota,
            commands::codex::codex_oauth_login_start,
            commands::codex::codex_oauth_login_completed,
            commands::codex::codex_oauth_submit_callback_url,
            commands::codex::codex_oauth_login_cancel,
            commands::codex::add_codex_account_with_token,
            commands::codex::add_codex_account_with_api_key,
            commands::codex::update_codex_account_name,
            commands::codex::update_codex_api_key_credentials,
            commands::codex::update_codex_api_key_bound_oauth_account,
            commands::codex::is_codex_oauth_port_in_use,
            commands::codex::close_codex_oauth_port,
            commands::codex::update_codex_account_tags,
            commands::codex::update_codex_account_note,
            commands::codex::codex_wakeup_get_cli_status,
            commands::codex::codex_wakeup_update_runtime_config,
            commands::codex::codex_wakeup_get_overview,
            commands::codex::codex_wakeup_get_state,
            commands::codex::codex_wakeup_save_state,
            commands::codex::codex_wakeup_load_history,
            commands::codex::codex_wakeup_clear_history,
            commands::codex::codex_wakeup_cancel_scope,
            commands::codex::codex_wakeup_release_scope,
            commands::codex::codex_wakeup_test,
            commands::codex::codex_wakeup_run_task,
            commands::codex::codex_wakeup_run_enabled_tasks,
            commands::codex::load_codex_account_groups,
            commands::codex::save_codex_account_groups,
            commands::codex::load_codex_model_providers,
            commands::codex::save_codex_model_providers,
            commands::codex::codex_test_model_provider_connection,
            commands::codex::codex_list_model_provider_models,
            commands::codex::codex_query_model_provider_usage,
            commands::codex::codex_local_access_get_state,
            commands::codex::codex_local_access_save_accounts,
            commands::codex::codex_local_access_remove_account,
            commands::codex::codex_local_access_rotate_api_key,
            commands::codex::codex_local_access_update_bound_oauth_account,
            commands::codex::codex_local_access_clear_stats,
            commands::codex::codex_local_access_query_request_logs,
            commands::codex::codex_local_access_prepare_restart,
            commands::codex::codex_local_access_kill_port,
            commands::codex::codex_local_access_update_port,
            commands::codex::codex_local_access_update_routing_strategy,
            commands::codex::codex_local_access_update_custom_routing,
            commands::codex::codex_local_access_update_account_model_rules,
            commands::codex::codex_local_access_update_model_rules,
            commands::codex::codex_local_access_update_model_pricings,
            commands::codex::codex_local_access_update_routing_options,
            commands::codex::codex_local_access_update_timeouts,
            commands::codex::codex_local_access_update_timeout_presets,
            commands::codex::codex_local_access_update_upstream_proxy_config,
            commands::codex::codex_local_access_update_gateway_mode,
            commands::codex::codex_local_access_update_debug_logs,
            commands::codex::codex_local_access_update_access_scope,
            commands::codex::codex_local_access_update_client_base_url_host,
            commands::codex::codex_local_access_update_image_generation_mode,
            commands::codex::codex_local_access_create_api_key,
            commands::codex::codex_local_access_update_api_key,
            commands::codex::codex_local_access_rotate_named_api_key,
            commands::codex::codex_local_access_delete_api_key,
            commands::codex::codex_local_access_set_enabled,
            commands::codex::codex_local_access_activate,
            commands::codex::codex_local_access_test,
            commands::codex::codex_local_access_chat_test,
            commands::codex::codex_local_access_chat_test_stream,
            // Codex Instance Commands
            commands::codex_instance::codex_get_instance_defaults,
            commands::codex_instance::codex_list_instances,
            commands::codex_instance::codex_get_instance_quick_config,
            commands::codex_instance::codex_save_instance_quick_config,
            commands::codex_instance::codex_open_instance_config_toml,
            commands::codex_instance::codex_sync_threads_across_instances,
            commands::codex_instance::codex_sync_sessions_to_instance,
            commands::codex_instance::codex_repair_session_visibility_across_instances,
            commands::codex_instance::codex_list_session_visibility_repair_providers,
            commands::codex_instance::codex_list_session_visibility_repair_instances,
            commands::codex_instance::codex_list_sessions_across_instances,
            commands::codex_instance::codex_get_session_token_stats_across_instances,
            commands::codex_instance::codex_move_sessions_to_trash_across_instances,
            commands::codex_instance::codex_list_trashed_sessions_across_instances,
            commands::codex_instance::codex_restore_sessions_from_trash_across_instances,
            commands::codex_instance::codex_create_instance,
            commands::codex_instance::codex_update_instance,
            commands::codex_instance::codex_delete_instance,
            commands::codex_instance::codex_start_instance,
            commands::codex_instance::codex_stop_instance,
            commands::codex_instance::codex_open_instance_window,
            commands::codex_instance::codex_close_all_instances,
            commands::codex_instance::codex_get_instance_launch_command,
            commands::codex_instance::codex_execute_instance_launch_command,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match &event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                tauri::async_runtime::block_on(async {
                    modules::codex_local_access::shutdown_local_access_gateway_for_app_exit().await;
                });
            }
            _ => {}
        }

        #[cfg(target_os = "macos")]
        {
            match event {
                RunEvent::Reopen { .. } => {
                    if let Err(err) = modules::floating_card_window::show_main_window(app_handle) {
                        logger::log_warn(&format!("[Window] Dock 重新打开主窗口失败: {}", err));
                    }
                }
                RunEvent::Opened { urls } => {
                    let args: Vec<String> = urls.iter().map(|url| url.to_string()).collect();
                    logger::log_info(&format!(
                        "[RunEvent] 收到 Opened 事件: url_count={}, urls={:?}",
                        args.len(),
                        args
                    ));
                    let handled = modules::external_import::handle_external_import_args(
                        app_handle,
                        &args,
                        "run-event-opened",
                    );
                    logger::log_info(&format!(
                        "[RunEvent] Opened 外部导入处理结果: handled={}",
                        handled
                    ));
                }
                _ => {}
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}

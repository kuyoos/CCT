//! 托盘布局配置
//! Codex-only 版本：保留既有配置文件与接口形态，旧平台条目在读取/保存时自动丢弃。

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

const TRAY_LAYOUT_FILE: &str = "tray_layout.json";

pub const PLATFORM_CODEX: &str = "codex";
pub const SUPPORTED_PLATFORM_IDS: [&str; 1] = [PLATFORM_CODEX];

pub const SORT_MODE_AUTO: &str = "auto";
pub const SORT_MODE_MANUAL: &str = "manual";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLayoutGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub platform_ids: Vec<String>,
    pub default_platform_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLayoutConfig {
    #[serde(default = "default_sort_mode")]
    pub sort_mode: String,
    #[serde(default = "default_order")]
    pub ordered_platform_ids: Vec<String>,
    #[serde(default = "default_tray_platforms")]
    pub tray_platform_ids: Vec<String>,
    #[serde(default = "default_ordered_entries")]
    pub ordered_entry_ids: Vec<String>,
    #[serde(default)]
    pub platform_groups: Vec<TrayLayoutGroup>,
}

fn default_sort_mode() -> String {
    SORT_MODE_AUTO.to_string()
}

fn default_order() -> Vec<String> {
    vec![PLATFORM_CODEX.to_string()]
}

fn default_tray_platforms() -> Vec<String> {
    default_order()
}

fn default_ordered_entries() -> Vec<String> {
    vec![format!("platform:{}", PLATFORM_CODEX)]
}

impl Default for TrayLayoutConfig {
    fn default() -> Self {
        Self {
            sort_mode: default_sort_mode(),
            ordered_platform_ids: default_order(),
            tray_platform_ids: default_tray_platforms(),
            ordered_entry_ids: default_ordered_entries(),
            platform_groups: Vec::new(),
        }
    }
}

fn get_tray_layout_path() -> Result<PathBuf, String> {
    Ok(crate::modules::config::get_data_dir()?.join(TRAY_LAYOUT_FILE))
}

fn normalize_sort_mode(raw: &str) -> String {
    match raw.trim() {
        SORT_MODE_MANUAL => SORT_MODE_MANUAL.to_string(),
        _ => SORT_MODE_AUTO.to_string(),
    }
}

fn sanitize_platform_ids(ids: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for id in ids {
        let trimmed = id.trim();
        if trimmed != PLATFORM_CODEX || result.iter().any(|existing| existing == PLATFORM_CODEX) {
            continue;
        }
        result.push(PLATFORM_CODEX.to_string());
    }
    result
}

fn normalize_group_id(raw: &str, index: usize, used: &HashSet<String>) -> String {
    let mut candidate = raw
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if candidate.is_empty() {
        candidate = format!("group-{}", index + 1);
    }

    if !used.contains(&candidate) {
        return candidate;
    }

    let mut suffix = 2usize;
    loop {
        let next = format!("{}-{}", candidate, suffix);
        if !used.contains(&next) {
            return next;
        }
        suffix += 1;
    }
}

fn normalize_platform_groups(groups: &[TrayLayoutGroup]) -> Vec<TrayLayoutGroup> {
    let mut normalized = Vec::new();
    let mut codex_used = false;
    let mut used_group_ids: HashSet<String> = HashSet::new();

    for (index, group) in groups.iter().enumerate() {
        let platform_ids = sanitize_platform_ids(&group.platform_ids);
        if platform_ids.is_empty() || codex_used {
            continue;
        }
        codex_used = true;

        let group_id = normalize_group_id(&group.id, index, &used_group_ids);
        let name = if group.name.trim().is_empty() {
            PLATFORM_CODEX.to_string()
        } else {
            group.name.trim().to_string()
        };

        normalized.push(TrayLayoutGroup {
            id: group_id.clone(),
            name,
            platform_ids,
            default_platform_id: PLATFORM_CODEX.to_string(),
        });
        used_group_ids.insert(group_id);
    }

    normalized
}

fn codex_entry_for_groups(groups: &[TrayLayoutGroup]) -> String {
    groups
        .iter()
        .find(|group| group.platform_ids.iter().any(|id| id == PLATFORM_CODEX))
        .map(|group| format!("group:{}", group.id))
        .unwrap_or_else(|| format!("platform:{}", PLATFORM_CODEX))
}

fn normalize_ordered_entries(raw_entries: &[String], groups: &[TrayLayoutGroup]) -> Vec<String> {
    let codex_entry = codex_entry_for_groups(groups);
    if raw_entries.iter().any(|entry| entry.trim() == codex_entry) {
        vec![codex_entry]
    } else {
        vec![codex_entry]
    }
}

fn normalize_config(config: TrayLayoutConfig) -> TrayLayoutConfig {
    let platform_groups = normalize_platform_groups(&config.platform_groups);

    TrayLayoutConfig {
        sort_mode: normalize_sort_mode(&config.sort_mode),
        ordered_platform_ids: default_order(),
        tray_platform_ids: default_tray_platforms(),
        ordered_entry_ids: normalize_ordered_entries(&config.ordered_entry_ids, &platform_groups),
        platform_groups,
    }
}

pub fn load_tray_layout() -> TrayLayoutConfig {
    let path = match get_tray_layout_path() {
        Ok(path) => path,
        Err(_) => return TrayLayoutConfig::default(),
    };

    if !path.exists() {
        return TrayLayoutConfig::default();
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => return TrayLayoutConfig::default(),
    };

    match serde_json::from_str::<TrayLayoutConfig>(&content) {
        Ok(config) => normalize_config(config),
        Err(error) => {
            match crate::modules::atomic_write::quarantine_file(&path, "invalid-json") {
                Ok(Some(backup_path)) => crate::modules::logger::log_warn(&format!(
                    "托盘布局配置解析失败，已隔离并使用默认布局: path={}, backup={}, error={}",
                    path.display(),
                    backup_path.display(),
                    error
                )),
                Ok(None) => crate::modules::logger::log_warn(&format!(
                    "托盘布局配置解析失败，文件已不存在，使用默认布局: path={}, error={}",
                    path.display(),
                    error
                )),
                Err(backup_error) => crate::modules::logger::log_warn(&format!(
                    "托盘布局配置解析失败，隔离失败，使用默认布局: path={}, parse_error={}, backup_error={}",
                    path.display(),
                    error,
                    backup_error
                )),
            }
            TrayLayoutConfig::default()
        }
    }
}

pub fn save_tray_layout(
    sort_mode: String,
    ordered_platform_ids: Vec<String>,
    tray_platform_ids: Vec<String>,
    ordered_entry_ids: Option<Vec<String>>,
    platform_groups: Option<Vec<TrayLayoutGroup>>,
) -> Result<TrayLayoutConfig, String> {
    let normalized = normalize_config(TrayLayoutConfig {
        sort_mode,
        ordered_platform_ids,
        tray_platform_ids,
        ordered_entry_ids: ordered_entry_ids.unwrap_or_default(),
        platform_groups: platform_groups.unwrap_or_default(),
    });

    let path = get_tray_layout_path()?;
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("序列化托盘布局配置失败: {}", e))?;
    crate::modules::atomic_write::write_string_atomic(&path, &content)
        .map_err(|e| format!("保存托盘布局配置失败: {}", e))?;
    Ok(normalized)
}

pub fn reset_tray_layout() -> Result<TrayLayoutConfig, String> {
    save_tray_layout(
        SORT_MODE_AUTO.to_string(),
        default_order(),
        default_tray_platforms(),
        Some(default_ordered_entries()),
        Some(Vec::new()),
    )
}
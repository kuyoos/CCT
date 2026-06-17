use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::modules;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDefaults {
    pub root_dir: String,
    pub default_user_data_dir: String,
}

pub fn get_default_user_data_dir() -> Result<PathBuf, String> {
    modules::codex_instance::get_default_codex_home()
}

pub fn get_default_instances_root_dir() -> Result<PathBuf, String> {
    modules::codex_instance::get_default_instances_root_dir()
}

pub fn get_instance_defaults() -> Result<InstanceDefaults, String> {
    modules::codex_instance::get_instance_defaults()
}

fn is_ignored_entry_name(name: &str) -> bool {
    matches!(name, ".DS_Store" | "Thumbs.db" | "desktop.ini")
}

pub fn is_profile_initialized(profile_dir: &Path) -> bool {
    if !profile_dir.exists() || !profile_dir.is_dir() {
        return false;
    }

    let Ok(entries) = fs::read_dir(profile_dir) else {
        return false;
    };

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if is_ignored_entry_name(&name) {
            continue;
        }
        return true;
    }

    false
}

pub fn delete_instance_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if !path.is_dir() {
        return Err("实例路径不是目录".to_string());
    }
    fs::remove_dir_all(path).map_err(|err| format!("删除实例目录失败: {}", err))
}
use std::path::PathBuf;

use crate::{Result, SandboxCoreError, SetupRecord};

/// 沙箱状态目录：%ProgramData%\FastAgent\sandbox
pub fn state_dir() -> PathBuf {
    let root = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    PathBuf::from(root).join("FastAgent").join("sandbox")
}

pub fn setup_path() -> PathBuf {
    state_dir().join("setup.json")
}

pub fn credentials_path() -> PathBuf {
    state_dir().join("credentials.bin")
}

pub fn read_setup() -> Result<SetupRecord> {
    let path = setup_path();
    let text = std::fs::read_to_string(&path)
        .map_err(|error| SandboxCoreError::with(format!("读取 {} 失败", path.display()), error))?;
    serde_json::from_str(&text)
        .map_err(|error| SandboxCoreError::with("解析 setup.json 失败", error))
}

pub fn write_setup(record: &SetupRecord) -> Result<()> {
    let dir = state_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|error| SandboxCoreError::with(format!("创建 {} 失败", dir.display()), error))?;
    let text = serde_json::to_string_pretty(record)
        .map_err(|error| SandboxCoreError::with("序列化 setup.json 失败", error))?;
    std::fs::write(setup_path(), text)
        .map_err(|error| SandboxCoreError::with("写入 setup.json 失败", error))
}

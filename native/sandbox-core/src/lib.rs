//! FastAgent 沙箱两个原生程序共用的基础设施：路径、凭据保护、账户 SID、宽字符转换。

pub mod credentials;
pub mod paths;
pub mod sid;
pub mod wide;

use std::fmt;

/// 统一错误类型：所有失败都要带上下文，便于 Host 侧把系统错误翻译成用户文案。
#[derive(Debug)]
pub struct SandboxCoreError {
    pub context: String,
    pub source: Option<String>,
}

impl SandboxCoreError {
    pub fn new(context: impl Into<String>) -> Self {
        Self { context: context.into(), source: None }
    }

    pub fn with(context: impl Into<String>, source: impl fmt::Display) -> Self {
        Self { context: context.into(), source: Some(source.to_string()) }
    }
}

impl fmt::Display for SandboxCoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.source {
            Some(source) => write!(formatter, "{}: {}", self.context, source),
            None => write!(formatter, "{}", self.context),
        }
    }
}

impl std::error::Error for SandboxCoreError {}

pub type Result<T> = std::result::Result<T, SandboxCoreError>;

/// setup.exe 与 runner 共同认可的版本；低于应用要求时 Host 判为 outdated。
pub const SANDBOX_VERSION: &str = "0.1.0";

/// Windows 本地用户名上限 20 字符，超出时 NetUserAdd 直接返回 2202（NERR_BadUsername）。
pub const OFFLINE_ACCOUNT: &str = "FastAgentSandboxOff";
pub const ONLINE_ACCOUNT: &str = "FastAgentSandboxOn";

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SetupRecord {
    pub version: String,
    #[serde(rename = "offlineSid")]
    pub offline_sid: String,
    #[serde(rename = "onlineSid")]
    pub online_sid: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

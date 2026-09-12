//! FastAgent 沙箱一次性初始化程序。需要管理员权限，只在用户点击「初始化 Agent 沙箱」时运行一次。
//!
//! 职责：创建两个低权限沙箱账户、配置登录权限、为离线账户写入出站阻断规则、
//! 保存受 DPAPI 保护的凭据、写入 setup.json。

mod accounts;
mod firewall;
mod rights;
mod token;

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use sandbox_core::{credentials, paths, Result, SetupRecord, OFFLINE_ACCOUNT, ONLINE_ACCOUNT, SANDBOX_VERSION};

fn main() {
    match run() {
        Ok(()) => {
            log("初始化完成");
            println!("FastAgent 沙箱初始化完成");
        }
        Err(error) => {
            log(&format!("初始化失败：{error}"));
            eprintln!("初始化失败：{error}");
            eprintln!("日志：{}", log_path().display());
            std::process::exit(1);
        }
    }
}

fn log_path() -> std::path::PathBuf {
    std::env::temp_dir().join("fastagent-sandbox-setup.log")
}

/// 提权进程通常跑在独立控制台里，出错时窗口一闪而过，落一份日志才能定位。
/// 只记录步骤与错误，绝不记录账户密码。
fn log(message: &str) {
    use std::io::Write;
    let line = format!("[{}] {message}\n", now_seconds());
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = file.write_all(line.as_bytes());
    }
}

fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_secs()).unwrap_or_default()
}

fn run() -> Result<()> {
    log("=== 开始初始化 ===");
    if !token::is_elevated()? {
        return Err(sandbox_core::SandboxCoreError::new(
            "初始化需要管理员权限，请通过 FastAgent 的「初始化 Agent 沙箱」按钮运行",
        ));
    }
    log("已确认管理员权限");

    let offline_password = accounts::random_password(32)?;
    let online_password = accounts::random_password(32)?;
    let offline_sid = accounts::ensure_account(
        OFFLINE_ACCOUNT,
        &offline_password,
        "FastAgent Agent 沙箱账户（禁止外部网络）",
    )?;
    let online_sid = accounts::ensure_account(
        ONLINE_ACCOUNT,
        &online_password,
        "FastAgent Agent 沙箱账户（允许网络）",
    )?;
    log("沙箱账户就绪");

    rights::apply(OFFLINE_ACCOUNT)?;
    rights::apply(ONLINE_ACCOUNT)?;
    log("登录权限已配置");
    firewall::ensure_offline_block(&offline_sid)?;
    log("离线账户出站阻断规则已写入");

    let mut map: BTreeMap<String, String> = BTreeMap::new();
    map.insert(OFFLINE_ACCOUNT.to_string(), offline_password);
    map.insert(ONLINE_ACCOUNT.to_string(), online_password);
    credentials::save(&map)?;
    // 凭据文件只留 SYSTEM、Administrators 与执行初始化的用户，避免同机其他用户读取。
    token::restrict_credentials_acl(&paths::credentials_path())?;
    log("凭据已保存并限权");

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_default();
    paths::write_setup(&SetupRecord {
        version: SANDBOX_VERSION.to_string(),
        offline_sid,
        online_sid,
        created_at,
    })
}

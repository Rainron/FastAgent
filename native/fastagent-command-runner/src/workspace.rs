use std::process::Command;

use sandbox_core::{sid, Result, SandboxCoreError};

/// 授予的权限档位。工作区要读写，内置工具链只读+执行——
/// runtime 是随包分发的二进制，沙箱内的命令没有任何理由改写它。
#[derive(Clone, Copy)]
pub enum Access {
    /// M：修改（读写删），用于工作区
    Modify,
    /// RX：读取与执行，用于内置工具链
    ReadExecute,
}

impl Access {
    fn mask(self) -> &'static str {
        match self {
            Access::Modify => "M",
            Access::ReadExecute => "RX",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Access::Modify => "工作区",
            Access::ReadExecute => "内置工具链",
        }
    }
}

/// 目标目录属主是当前用户，授权沙箱账户不需要管理员权限。
/// 只授予该目录本身（含继承），目录之外不给任何权限。
/// 受限令牌由 DISABLE_MAX_PRIVILEGE 派生，保留 SeChangeNotifyPrivilege，
/// 因此父目录不需要额外的穿越权限。
pub fn run(args: &[String], access: Access) -> Result<()> {
    let path = args
        .get(1)
        .ok_or_else(|| SandboxCoreError::new("授权命令缺少路径"))?;
    let account_index = args
        .iter()
        .position(|item| item == "--account")
        .ok_or_else(|| SandboxCoreError::new("缺少 --account"))?;
    let account = args
        .get(account_index + 1)
        .ok_or_else(|| SandboxCoreError::new("--account 缺少参数"))?;

    let account_sid = sid::lookup_account_sid(account)?;
    let output = Command::new("icacls.exe")
        .arg(path)
        .args([
            "/grant",
            &format!("*{account_sid}:(OI)(CI){}", access.mask()),
        ])
        .output()
        .map_err(|error| SandboxCoreError::with("调用 icacls 失败", error))?;
    if !output.status.success() {
        return Err(SandboxCoreError::new(format!(
            "授予{}权限失败：{}",
            access.label(),
            String::from_utf8_lossy(&output.stdout).trim()
        )));
    }
    Ok(())
}

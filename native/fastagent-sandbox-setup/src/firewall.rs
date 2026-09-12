use std::process::Command;

use sandbox_core::{Result, SandboxCoreError};

const RULE_NAME: &str = "FastAgent Sandbox Offline Block";

/// 离线账户的出站阻断规则在初始化时一次性写入。
/// 运行期只按网络模式选账户，不再改动防火墙，因此不会反复要求管理员权限。
pub fn ensure_offline_block(offline_sid: &str) -> Result<()> {
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         Get-NetFirewallRule -DisplayName '{name}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule; \
         New-NetFirewallRule -DisplayName '{name}' -Direction Outbound -Action Block \
           -Profile Any -Enabled True -LocalUser 'D:(A;;CC;;;{sid})' | Out-Null",
        name = RULE_NAME,
        sid = offline_sid
    );
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| SandboxCoreError::with("调用 PowerShell 配置防火墙失败", error))?;
    if !output.status.success() {
        return Err(SandboxCoreError::new(format!(
            "创建出站阻断规则失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

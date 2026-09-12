use std::path::Path;
use std::process::Command;

use sandbox_core::wide::from_wide_ptr;
use sandbox_core::{Result, SandboxCoreError};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL};
use windows::Win32::Security::PSID;
use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows::Win32::Security::{
    GetTokenInformation, TokenElevation, TokenUser, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER,
};
use windows::Win32::Foundation::LocalFree;
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

fn current_token() -> Result<HANDLE> {
    let mut token = HANDLE::default();
    unsafe {
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|error| SandboxCoreError::with("打开进程令牌失败", error))?;
    }
    Ok(token)
}

pub fn is_elevated() -> Result<bool> {
    let token = current_token()?;
    let mut elevation = TOKEN_ELEVATION::default();
    let mut size = 0u32;
    let result = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        )
    };
    unsafe { let _ = CloseHandle(token); }
    result.map_err(|error| SandboxCoreError::with("查询令牌提升状态失败", error))?;
    Ok(elevation.TokenIsElevated != 0)
}

/// 当前用户 SID：提升后的进程与桌面用户是同一个账户，可直接用于 ACL。
pub fn current_user_sid() -> Result<String> {
    let token = current_token()?;
    let mut size = 0u32;
    unsafe {
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut size);
    }
    let mut buffer = vec![0u8; size.max(1) as usize];
    let query = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr() as *mut _),
            size,
            &mut size,
        )
    };
    unsafe { let _ = CloseHandle(token); }
    query.map_err(|error| SandboxCoreError::with("查询当前用户失败", error))?;

    let user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
    let mut text = windows::core::PWSTR::null();
    unsafe {
        ConvertSidToStringSidW(PSID(user.User.Sid.0), &mut text)
            .map_err(|error| SandboxCoreError::with("SID 转换失败", error))?;
    }
    let value = unsafe { from_wide_ptr(text.0) };
    unsafe { let _ = LocalFree(Some(HLOCAL(text.0 as *mut _))); }
    Ok(value)
}

/// 断开继承并只保留 SYSTEM、Administrators 与安装用户。
pub fn restrict_credentials_acl(path: &Path) -> Result<()> {
    let user_sid = current_user_sid()?;
    let output = Command::new("icacls.exe")
        .arg(path)
        .args([
            "/inheritance:r",
            "/grant",
            "*S-1-5-18:F",
            "/grant",
            "*S-1-5-32-544:F",
            "/grant",
            &format!("*{user_sid}:R"),
        ])
        .output()
        .map_err(|error| SandboxCoreError::with("调用 icacls 失败", error))?;
    if !output.status.success() {
        return Err(SandboxCoreError::new(format!(
            "设置凭据文件权限失败：{}",
            String::from_utf8_lossy(&output.stdout).trim()
        )));
    }
    Ok(())
}

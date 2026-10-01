use windows::Win32::Foundation::HLOCAL;
use windows::Win32::Security::PSID;
use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSidToSidW};
use windows::Win32::Security::{LookupAccountNameW, LookupAccountSidW, SID_NAME_USE};
use windows::Win32::Foundation::LocalFree;

/// BUILTIN\Users 的 well-known SID。组名在非英文系统上会本地化，按 SID 反查才稳。
const BUILTIN_USERS_SID: &str = "S-1-5-32-545";

use crate::wide::{from_wide_ptr, pcwstr, to_wide};
use crate::{Result, SandboxCoreError};

/// 查询本地账户的二进制 SID，供需要 PSID 的 API 使用。
pub fn lookup_account_sid_bytes(account: &str) -> Result<Vec<u8>> {
    let name = to_wide(account);
    let mut sid_size = 0u32;
    let mut domain_size = 0u32;
    let mut use_kind = SID_NAME_USE::default();
    unsafe {
        let _ = LookupAccountNameW(None, pcwstr(&name), None, &mut sid_size, None, &mut domain_size, &mut use_kind);
    }
    if sid_size == 0 {
        return Err(SandboxCoreError::new(format!("找不到账户 {account}")));
    }
    let mut sid_buffer = vec![0u8; sid_size as usize];
    let mut domain_buffer = vec![0u16; domain_size.max(1) as usize];
    unsafe {
        LookupAccountNameW(
            None,
            pcwstr(&name),
            Some(PSID(sid_buffer.as_mut_ptr() as *mut _)),
            &mut sid_size,
            Some(windows::core::PWSTR(domain_buffer.as_mut_ptr())),
            &mut domain_size,
            &mut use_kind,
        )
        .map_err(|error| SandboxCoreError::with(format!("查询账户 {account} 失败"), error))?;
    }
    Ok(sid_buffer)
}

/// 查询本地账户 SID 的字符串形式（S-1-5-21-…）。
pub fn lookup_account_sid(account: &str) -> Result<String> {
    let name = to_wide(account);
    let mut sid_size = 0u32;
    let mut domain_size = 0u32;
    let mut use_kind = SID_NAME_USE::default();

    // 第一次调用只为取长度，必然返回失败，忽略返回值。
    unsafe {
        let _ = LookupAccountNameW(
            None,
            pcwstr(&name),
            None,
            &mut sid_size,
            None,
            &mut domain_size,
            &mut use_kind,
        );
    }
    if sid_size == 0 {
        return Err(SandboxCoreError::new(format!("找不到账户 {account}")));
    }

    let mut sid_buffer = vec![0u8; sid_size as usize];
    let mut domain_buffer = vec![0u16; domain_size.max(1) as usize];
    unsafe {
        LookupAccountNameW(
            None,
            pcwstr(&name),
            Some(PSID(sid_buffer.as_mut_ptr() as *mut _)),
            &mut sid_size,
            Some(windows::core::PWSTR(domain_buffer.as_mut_ptr())),
            &mut domain_size,
            &mut use_kind,
        )
        .map_err(|error| SandboxCoreError::with(format!("查询账户 {account} 失败"), error))?;
    }

    let mut text = windows::core::PWSTR::null();
    unsafe {
        ConvertSidToStringSidW(PSID(sid_buffer.as_mut_ptr() as *mut _), &mut text)
            .map_err(|error| SandboxCoreError::with("SID 转换失败", error))?;
    }
    let value = unsafe { from_wide_ptr(text.0) };
    unsafe { let _ = LocalFree(Some(HLOCAL(text.0 as *mut _))); }
    Ok(value)
}

pub fn account_exists(account: &str) -> bool {
    lookup_account_sid(account).is_ok()
}

/// BUILTIN\Users 的本地名，供 NetLocalGroupAddMembers 使用。
/// 不写死 "Users"：该组在本地化系统上显示名会变，写死会在用户机器上静默失败。
pub fn builtin_users_group_name() -> Result<String> {
    let text = to_wide(BUILTIN_USERS_SID);
    let mut psid = PSID::default();
    unsafe {
        ConvertStringSidToSidW(pcwstr(&text), &mut psid)
            .map_err(|error| SandboxCoreError::with("解析内置 Users 组 SID 失败", error))?;
    }
    let result = lookup_sid_name(psid);
    unsafe { let _ = LocalFree(Some(HLOCAL(psid.0 as *mut _))); }
    result
}

fn lookup_sid_name(psid: PSID) -> Result<String> {
    let mut name_size = 0u32;
    let mut domain_size = 0u32;
    let mut use_kind = SID_NAME_USE::default();
    // 第一次调用只为取长度，必然返回失败，忽略返回值。
    unsafe {
        let _ = LookupAccountSidW(None, psid, None, &mut name_size, None, &mut domain_size, &mut use_kind);
    }
    if name_size == 0 {
        return Err(SandboxCoreError::new("查询内置组名称失败：返回长度为 0"));
    }
    let mut name_buffer = vec![0u16; name_size as usize];
    let mut domain_buffer = vec![0u16; domain_size.max(1) as usize];
    unsafe {
        LookupAccountSidW(
            None,
            psid,
            Some(windows::core::PWSTR(name_buffer.as_mut_ptr())),
            &mut name_size,
            Some(windows::core::PWSTR(domain_buffer.as_mut_ptr())),
            &mut domain_size,
            &mut use_kind,
        )
        .map_err(|error| SandboxCoreError::with("查询内置组名称失败", error))?;
    }
    Ok(String::from_utf16_lossy(&name_buffer[..name_size as usize]))
}

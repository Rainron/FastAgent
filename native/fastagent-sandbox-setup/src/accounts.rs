use sandbox_core::wide::{pcwstr, to_wide};
use sandbox_core::{sid, Result, SandboxCoreError};
use windows::Win32::NetworkManagement::NetManagement::{
    NetUserAdd, NetUserSetInfo, UF_DONT_EXPIRE_PASSWD, UF_PASSWD_CANT_CHANGE, UF_SCRIPT,
    USER_INFO_1, USER_INFO_1003, USER_PRIV_USER,
};
use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};

const PASSWORD_ALPHABET: &[u8] =
    b"abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*()-_=+";

/// 随机密码只在初始化时生成一次，之后仅用于以沙箱身份启动 runner。
pub fn random_password(length: usize) -> Result<String> {
    let mut bytes = vec![0u8; length];
    unsafe {
        BCryptGenRandom(None, &mut bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG)
            .ok()
            .map_err(|error| SandboxCoreError::with("生成随机密码失败", error))?;
    }
    Ok(bytes
        .into_iter()
        .map(|byte| PASSWORD_ALPHABET[byte as usize % PASSWORD_ALPHABET.len()] as char)
        .collect())
}

/// 创建或重置沙箱账户。只给 USER_PRIV_USER（自动进 Users 组），
/// 不加入 Administrators / Power Users / Remote Desktop Users。
pub fn ensure_account(account: &str, password: &str, comment: &str) -> Result<String> {
    if sid::account_exists(account) {
        reset_password(account, password)?;
    } else {
        create_account(account, password, comment)?;
    }
    sid::lookup_account_sid(account)
}

fn create_account(account: &str, password: &str, comment: &str) -> Result<()> {
    let mut name = to_wide(account);
    let mut secret = to_wide(password);
    let mut note = to_wide(comment);
    let info = USER_INFO_1 {
        usri1_name: windows::core::PWSTR(name.as_mut_ptr()),
        usri1_password: windows::core::PWSTR(secret.as_mut_ptr()),
        usri1_password_age: 0,
        usri1_priv: USER_PRIV_USER,
        usri1_home_dir: windows::core::PWSTR::null(),
        usri1_comment: windows::core::PWSTR(note.as_mut_ptr()),
        usri1_flags: UF_SCRIPT | UF_DONT_EXPIRE_PASSWD | UF_PASSWD_CANT_CHANGE,
        usri1_script_path: windows::core::PWSTR::null(),
    };
    let mut error_index = 0u32;
    let status = unsafe {
        NetUserAdd(
            None,
            1,
            &info as *const _ as *const u8,
            Some(&mut error_index),
        )
    };
    if status != 0 {
        return Err(SandboxCoreError::new(format!(
            "创建账户 {account} 失败（NetUserAdd 返回 {status}，字段 {error_index}）"
        )));
    }
    Ok(())
}

fn reset_password(account: &str, password: &str) -> Result<()> {
    let name = to_wide(account);
    let mut secret = to_wide(password);
    let info = USER_INFO_1003 { usri1003_password: windows::core::PWSTR(secret.as_mut_ptr()) };
    let status = unsafe {
        NetUserSetInfo(
            None,
            pcwstr(&name),
            1003,
            &info as *const _ as *const u8,
            None,
        )
    };
    if status != 0 {
        return Err(SandboxCoreError::new(format!(
            "重置账户 {account} 密码失败（NetUserSetInfo 返回 {status}）"
        )));
    }
    Ok(())
}

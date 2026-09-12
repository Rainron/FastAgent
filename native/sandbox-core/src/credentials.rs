use std::collections::BTreeMap;

use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_LOCAL_MACHINE, CRYPT_INTEGER_BLOB,
};
use windows::Win32::Foundation::LocalFree;
use windows::Win32::Foundation::HLOCAL;

use crate::{paths, Result, SandboxCoreError};

/// 账户名 → 密码。密码只用于以沙箱身份启动 runner，从不进入子进程环境。
pub type CredentialMap = BTreeMap<String, String>;

fn blob(data: &mut [u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_mut_ptr() }
}

/// 用机器范围的 DPAPI 保护：初始化由管理员完成，读取方是普通用户身份的应用进程。
/// 文件本身再用 ACL 限制到安装用户，避免同机其他用户拿到凭据。
pub fn protect(plain: &[u8]) -> Result<Vec<u8>> {
    let mut input = plain.to_vec();
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &blob(&mut input),
            None,
            None,
            None,
            None,
            CRYPTPROTECT_LOCAL_MACHINE,
            &mut output,
        )
        .map_err(|error| SandboxCoreError::with("DPAPI 加密失败", error))?;
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _))); }
    Ok(bytes)
}

pub fn unprotect(sealed: &[u8]) -> Result<Vec<u8>> {
    let mut input = sealed.to_vec();
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &blob(&mut input),
            None,
            None,
            None,
            None,
            CRYPTPROTECT_LOCAL_MACHINE,
            &mut output,
        )
        .map_err(|error| SandboxCoreError::with("DPAPI 解密失败", error))?;
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _))); }
    Ok(bytes)
}

pub fn save(map: &CredentialMap) -> Result<()> {
    let json = serde_json::to_vec(map)
        .map_err(|error| SandboxCoreError::with("序列化凭据失败", error))?;
    let sealed = protect(&json)?;
    let dir = paths::state_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|error| SandboxCoreError::with(format!("创建 {} 失败", dir.display()), error))?;
    std::fs::write(paths::credentials_path(), sealed)
        .map_err(|error| SandboxCoreError::with("写入凭据文件失败", error))
}

pub fn load() -> Result<CredentialMap> {
    let sealed = std::fs::read(paths::credentials_path())
        .map_err(|error| SandboxCoreError::with("读取凭据文件失败", error))?;
    let json = unprotect(&sealed)?;
    serde_json::from_slice(&json)
        .map_err(|error| SandboxCoreError::with("解析凭据失败", error))
}

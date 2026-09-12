use sandbox_core::wide::to_wide;
use sandbox_core::{sid, Result, SandboxCoreError};
use windows::Win32::Security::PSID;
use windows::Win32::Security::Authentication::Identity::{
    LsaAddAccountRights, LsaClose, LsaOpenPolicy, LsaRemoveAccountRights, LSA_HANDLE, LSA_OBJECT_ATTRIBUTES,
    LSA_UNICODE_STRING,
};

const POLICY_CREATE_ACCOUNT: u32 = 0x0000_0010;
const POLICY_LOOKUP_NAMES: u32 = 0x0000_0800;

pub const GRANTED_RIGHTS: &[&str] = &["SeBatchLogonRight"];

/// 网络、远程桌面与服务登录一律拒绝。
///
/// 交互登录不能拒绝：`CreateProcessWithLogonW` 经 Secondary Logon 服务发起的是
/// 交互式登录，加上 `SeDenyInteractiveLogonRight` 会让沙箱自己起不来
/// （0x80070569「未授予用户在此计算机上的请求登录类型」）。
/// 账户密码只存在于 DPAPI 密文里、不对用户展示，且登录界面不列出该账户，
/// 因此保留交互登录权限的实际暴露面很小。
pub const DENIED_RIGHTS: &[&str] = &[
    "SeDenyNetworkLogonRight",
    "SeDenyRemoteInteractiveLogonRight",
    "SeDenyServiceLogonRight",
];

/// 旧版本 setup 写过的权限：重新初始化时必须撤掉，否则已有账户仍然登录不了。
pub const REVOKED_RIGHTS: &[&str] = &["SeDenyInteractiveLogonRight"];

fn unicode_string(buffer: &mut Vec<u16>) -> LSA_UNICODE_STRING {
    // Length 不含结尾 NUL，MaximumLength 含；LSA 对此非常严格。
    LSA_UNICODE_STRING {
        Length: ((buffer.len() - 1) * 2) as u16,
        MaximumLength: (buffer.len() * 2) as u16,
        Buffer: windows::core::PWSTR(buffer.as_mut_ptr()),
    }
}

pub fn apply(account: &str) -> Result<()> {
    let mut sid_bytes = sid::lookup_account_sid_bytes(account)?;
    let attributes = LSA_OBJECT_ATTRIBUTES::default();
    let mut policy = LSA_HANDLE::default();
    unsafe {
        LsaOpenPolicy(
            None,
            &attributes,
            POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES,
            &mut policy,
        )
        .ok()
        .map_err(|error| SandboxCoreError::with("打开 LSA 策略失败", error))?;
    }

    let result = (|| -> Result<()> {
        let mut buffers: Vec<Vec<u16>> = GRANTED_RIGHTS
            .iter()
            .chain(DENIED_RIGHTS.iter())
            .map(|right| to_wide(right))
            .collect();
        let rights: Vec<LSA_UNICODE_STRING> = buffers.iter_mut().map(unicode_string).collect();
        unsafe {
            LsaAddAccountRights(
                policy,
                PSID(sid_bytes.as_mut_ptr() as *mut _),
                &rights,
            )
            .ok()
            .map_err(|error| SandboxCoreError::with(format!("为 {account} 配置登录权限失败"), error))?;
        }

        let mut revoked_buffers: Vec<Vec<u16>> = REVOKED_RIGHTS.iter().map(|right| to_wide(right)).collect();
        let revoked: Vec<LSA_UNICODE_STRING> = revoked_buffers.iter_mut().map(unicode_string).collect();
        unsafe {
            // 账户从未持有该权限时返回 STATUS_OBJECT_NAME_NOT_FOUND，属于正常情况，忽略。
            let _ = LsaRemoveAccountRights(
                policy,
                PSID(sid_bytes.as_mut_ptr() as *mut _),
                false,
                Some(&revoked),
            );
        }
        Ok(())
    })();

    unsafe { let _ = LsaClose(policy); }
    result
}

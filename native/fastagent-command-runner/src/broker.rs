use sandbox_core::wide::{pcwstr, to_wide};
use sandbox_core::{credentials, Result, SandboxCoreError};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
use windows::Win32::System::Threading::{
    CreateProcessWithLogonW, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT,
    INFINITE, LOGON_WITH_PROFILE, PROCESS_INFORMATION, STARTUPINFOW,
};
use windows::Win32::System::Threading::STARTUPINFOW_FLAGS;

use crate::protocol::SessionArgs;
use crate::win::duplicate_inheritable;

const STARTF_USESTDHANDLES: STARTUPINFOW_FLAGS = STARTUPINFOW_FLAGS(0x0000_0100);

/// 以沙箱账户身份把自己重新拉起为 worker。
///
/// Electron 主进程是标准用户进程，拿不到 SE_ASSIGNPRIMARYTOKEN，
/// 无法直接用别人的令牌建进程；CreateProcessWithLogonW 走 Secondary Logon 服务，
/// 标准用户可用，是这条链路上唯一可行的第一跳。
pub fn run(payload: &str) -> Result<()> {
    let session: SessionArgs = serde_json::from_str(payload)
        .map_err(|error| SandboxCoreError::with("解析会话参数失败", error))?;
    let map = credentials::load()?;
    let password = map
        .get(&session.account)
        .ok_or_else(|| SandboxCoreError::new(format!("凭据中缺少账户 {}", session.account)))?;

    let executable = std::env::current_exe()
        .map_err(|error| SandboxCoreError::with("获取自身路径失败", error))?;
    let mut command_line = to_wide(&format!(
        "\"{}\" --worker {}",
        executable.display(),
        quote(payload)
    ));

    // Host 的标准流直接交给 worker，Broker 不做中转，避免多一层缓冲与背压。
    let stdin = duplicate_inheritable(std_handle(STD_INPUT_HANDLE)?)?;
    let stdout = duplicate_inheritable(std_handle(STD_OUTPUT_HANDLE)?)?;
    let stderr = duplicate_inheritable(std_handle(STD_ERROR_HANDLE)?)?;

    let mut startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTF_USESTDHANDLES,
        hStdInput: stdin.raw(),
        hStdOutput: stdout.raw(),
        hStdError: stderr.raw(),
        ..Default::default()
    };
    let mut information = PROCESS_INFORMATION::default();

    let user = to_wide(&session.account);
    let domain = to_wide(".");
    let secret = to_wide(password);
    unsafe {
        CreateProcessWithLogonW(
            pcwstr(&user),
            pcwstr(&domain),
            pcwstr(&secret),
            LOGON_WITH_PROFILE,
            None,
            Some(windows::core::PWSTR(command_line.as_mut_ptr())),
            CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            None,
            None,
            &mut startup,
            &mut information,
        )
        .map_err(|error| {
            SandboxCoreError::with(format!("以 {} 身份启动沙箱执行器失败", session.account), error)
        })?;
    }

    unsafe {
        WaitForSingleObject(information.hProcess, INFINITE);
        let _ = CloseHandle(information.hThread);
        let _ = CloseHandle(information.hProcess);
    }
    Ok(())
}

fn std_handle(kind: windows::Win32::System::Console::STD_HANDLE) -> Result<HANDLE> {
    unsafe { GetStdHandle(kind) }.map_err(|error| SandboxCoreError::with("获取标准流句柄失败", error))
}

/// 会话参数里含引号与反斜杠，必须按 Windows 命令行规则转义后再拼接。
fn quote(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    let mut backslashes = 0usize;
    for character in value.chars() {
        match character {
            '\\' => {
                backslashes += 1;
                quoted.push('\\');
            }
            '"' => {
                for _ in 0..=backslashes {
                    quoted.push('\\');
                }
                backslashes = 0;
                quoted.push('"');
            }
            _ => {
                backslashes = 0;
                quoted.push(character);
            }
        }
    }
    for _ in 0..backslashes {
        quoted.push('\\');
    }
    quoted.push('"');
    quoted
}

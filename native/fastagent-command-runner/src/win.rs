use std::collections::BTreeMap;

use sandbox_core::{Result, SandboxCoreError};
use windows::Win32::Foundation::{
    CloseHandle, DuplicateHandle, SetHandleInformation, DUPLICATE_SAME_ACCESS, HANDLE,
    HANDLE_FLAG_INHERIT, HANDLE_FLAGS,
};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::Storage::FileSystem::ReadFile;
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::GetCurrentProcess;

/// 句柄 RAII：泵送线程与父进程都持有句柄，漏关会让管道读不到 EOF。
pub struct OwnedHandle(pub HANDLE);

impl OwnedHandle {
    pub fn raw(&self) -> HANDLE {
        self.0
    }

}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe { let _ = CloseHandle(self.0); }
        }
    }
}

unsafe impl Send for OwnedHandle {}

pub fn inheritable_attributes() -> SECURITY_ATTRIBUTES {
    SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: true.into(),
    }
}

/// 返回 (读端, 写端)；`inherit_write` 决定子进程继承哪一端，另一端强制不可继承。
pub fn create_pipe(inherit_write: bool) -> Result<(OwnedHandle, OwnedHandle)> {
    let attributes = inheritable_attributes();
    let mut read = HANDLE::default();
    let mut write = HANDLE::default();
    unsafe {
        CreatePipe(&mut read, &mut write, Some(&attributes), 0)
            .map_err(|error| SandboxCoreError::with("创建管道失败", error))?;
    }
    let keep = if inherit_write { read } else { write };
    unsafe {
        SetHandleInformation(keep, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0))
            .map_err(|error| SandboxCoreError::with("设置管道句柄继承属性失败", error))?;
    }
    Ok((OwnedHandle(read), OwnedHandle(write)))
}

/// 复制一份可继承的句柄，用于把 Host 给的标准流传给以其他身份启动的子进程。
pub fn duplicate_inheritable(handle: HANDLE) -> Result<OwnedHandle> {
    let mut target = HANDLE::default();
    unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            handle,
            GetCurrentProcess(),
            &mut target,
            0,
            true,
            DUPLICATE_SAME_ACCESS,
        )
        .map_err(|error| SandboxCoreError::with("复制标准流句柄失败", error))?;
    }
    Ok(OwnedHandle(target))
}

/// UTF-16 环境块：K=V\0K=V\0\0，配合 CREATE_UNICODE_ENVIRONMENT 使用。
pub fn environment_block(env: &BTreeMap<String, String>) -> Vec<u16> {
    let mut block: Vec<u16> = Vec::new();
    for (key, value) in env {
        block.extend(format!("{key}={value}").encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

/// 同步读取管道直到 EOF，每块交给回调；返回读到的总字节数。
pub fn pump<F: FnMut(&[u8])>(handle: &OwnedHandle, mut on_chunk: F) {
    let mut buffer = [0u8; 8192];
    loop {
        let mut read = 0u32;
        let result = unsafe { ReadFile(handle.raw(), Some(&mut buffer), Some(&mut read), None) };
        if result.is_err() || read == 0 {
            break;
        }
        on_chunk(&buffer[..read as usize]);
    }
}

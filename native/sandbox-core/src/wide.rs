use windows::core::{PCWSTR, PWSTR};

/// Rust 字符串转 NUL 结尾的 UTF-16 缓冲区；调用方必须持有缓冲区直到 API 返回。
pub fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn pcwstr(buffer: &[u16]) -> PCWSTR {
    PCWSTR(buffer.as_ptr())
}

pub fn pwstr(buffer: &mut [u16]) -> PWSTR {
    PWSTR(buffer.as_mut_ptr())
}

/// 读取以 NUL 结尾的 UTF-16 指针内容。
///
/// # Safety
/// `pointer` 必须指向有效且以 NUL 结尾的 UTF-16 缓冲区。
pub unsafe fn from_wide_ptr(pointer: *const u16) -> String {
    if pointer.is_null() {
        return String::new();
    }
    let mut length = 0usize;
    while unsafe { *pointer.add(length) } != 0 {
        length += 1;
    }
    let slice = unsafe { std::slice::from_raw_parts(pointer, length) };
    String::from_utf16_lossy(slice)
}

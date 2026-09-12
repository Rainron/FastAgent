//! FastAgent 沙箱命令执行器。
//!
//! 三种运行模式：
//! - `--session <json>`：以当前用户身份启动，用 CreateProcessWithLogonW 把自己
//!   以沙箱账户重新拉起为 worker，并把 Host 的标准流直接交给它。
//! - `--worker <json>`：以沙箱账户身份运行，负责 Restricted Token、Job Object
//!   与命令进程树，按 JSONL 协议与 Host 通信。
//! - `--grant-workspace <path> --account <name>`：给沙箱账户授予工作区读写权限。
//! - `--grant-runtime <path> --account <name>`：给沙箱账户授予内置工具链的只读+执行权限。
mod broker;
mod protocol;
mod win;
mod worker;
mod workspace;

use sandbox_core::SANDBOX_VERSION;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("--version") => {
            println!("{SANDBOX_VERSION}");
            Ok(())
        }
        Some("--session") => match args.get(1) {
            Some(payload) => broker::run(payload),
            None => Err(sandbox_core::SandboxCoreError::new("--session 缺少参数")),
        },
        Some("--worker") => match args.get(1) {
            Some(payload) => worker::run(payload),
            None => Err(sandbox_core::SandboxCoreError::new("--worker 缺少参数")),
        },
        Some("--grant-workspace") => workspace::run(&args, workspace::Access::Modify),
        Some("--grant-runtime") => workspace::run(&args, workspace::Access::ReadExecute),
        _ => Err(sandbox_core::SandboxCoreError::new(
            "用法：--session <json> | --worker <json> | --grant-workspace <path> --account <name> | --grant-runtime <path> --account <name> | --version",
        )),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

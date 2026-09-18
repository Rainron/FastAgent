use std::collections::{BTreeMap, HashMap};
use std::io::BufRead;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::thread::JoinHandle;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sandbox_core::wide::to_wide;
use sandbox_core::{Result, SandboxCoreError};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT};
use windows::Win32::Security::{
    CreateRestrictedToken, DISABLE_MAX_PRIVILEGE, TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_QUERY,
};
use windows::Win32::Storage::FileSystem::WriteFile;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, TerminateJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, ResumeThread,
    WaitForSingleObject, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, CREATE_SUSPENDED,
    CREATE_UNICODE_ENVIRONMENT, INFINITE, PROCESS_INFORMATION, STARTUPINFOW, STARTUPINFOW_FLAGS,
};

use crate::protocol::{decode_base64, Request, Response, SessionArgs, Writer};
use crate::win::{create_pipe, environment_block, pump, OwnedHandle};

const STARTF_USESTDHANDLES: STARTUPINFOW_FLAGS = STARTUPINFOW_FLAGS(0x0000_0100);

struct RunningProcess {
    job: HANDLE,
    stdin: Arc<OwnedHandle>,
    cancelled: Arc<AtomicBool>,
}

unsafe impl Send for RunningProcess {}

/// HANDLE 本身不是 Send；等待线程只做 Wait/Terminate/Close，跨线程持有是安全的。
#[derive(Clone, Copy)]
struct SendHandle(HANDLE);

unsafe impl Send for SendHandle {}

impl SendHandle {
    /// 用方法而不是字段访问：2021 版闭包按字段捕获，直接取 .0 会绕过这里的 Send 标记。
    fn get(self) -> HANDLE {
        self.0
    }
}

type Registry = Arc<Mutex<HashMap<String, RunningProcess>>>;

pub fn run(payload: &str) -> Result<()> {
    let session: SessionArgs = serde_json::from_str(payload)
        .map_err(|error| SandboxCoreError::with("解析会话参数失败", error))?;
    let writer = Arc::new(Writer::new());
    let registry: Registry = Arc::new(Mutex::new(HashMap::new()));

    // 握手帧：Host 据此判断沙箱身份确实建立起来了。缺少它就不放行本次任务，
    // 避免「会话创建成功、第一条命令才失败」这种迟到的错误。
    writer.send(&Response::Ready { session: session.session_id.clone(), account: session.account.clone() });

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(request) = serde_json::from_str::<Request>(trimmed) else { continue };
        match request {
            Request::Exec { id, command, cwd, env, timeout_ms } => {
                let timeout = timeout_ms.unwrap_or(session.timeout_ms);
                if let Err(error) = spawn_command(
                    &session,
                    &writer,
                    &registry,
                    id.clone(),
                    command,
                    cwd,
                    env,
                    timeout,
                ) {
                    eprintln!("{error}");
                    writer.send(&Response::Error { id, code: "runner_failed".into(), target: None });
                }
            }
            Request::Stdin { id, data } => {
                let bytes = decode_base64(&data);
                let handle = registry.lock().ok().and_then(|map| map.get(&id).map(|entry| entry.stdin.clone()));
                if let Some(handle) = handle {
                    let mut written = 0u32;
                    unsafe { let _ = WriteFile(handle.raw(), Some(&bytes), Some(&mut written), None); }
                }
            }
            Request::Cancel { id } => {
                if let Ok(map) = registry.lock() {
                    if let Some(entry) = map.get(&id) {
                        entry.cancelled.store(true, Ordering::Release);
                        // 终止整个 Job：Agent 派生的孙进程一并结束，不留后台残留。
                        unsafe { let _ = TerminateJobObject(entry.job, 1); }
                    }
                }
            }
        }
    }

    // Host 关闭 stdin 即会话结束，清掉所有仍在运行的进程树。
    if let Ok(map) = registry.lock() {
        for entry in map.values() {
            unsafe { let _ = TerminateJobObject(entry.job, 1); }
        }
    }
    Ok(())
}

/// 属于「用户身份」的变量必须取沙箱账户自己的值：
/// Host 传来的 TEMP / USERPROFILE 指向调用者的目录，沙箱账户没有写权限，
/// 直接沿用会让 npm、pip、git 这类需要临时目录与 HOME 的工具全部失败。
const PROFILE_SCOPED_VARS: &[&str] = &[
    "TEMP",
    "TMP",
    "USERPROFILE",
    // HOME 是 Git Bash 找 .bash_profile 的首选依据，漏掉它等于把宿主用户的家目录带进沙箱
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "USERNAME",
    "USERDOMAIN",
];

/// 凭据类变量的兜底过滤。Host 侧 sanitizeEnvironment 已经筛过一遍，
/// 这里再筛一次：runner 是进入沙箱前的最后一道闸，不能只依赖上游名单不出错。
fn is_credential_var(key: &str) -> bool {
    let upper = key.to_uppercase();
    const SUFFIXES: &[&str] = &["_API_KEY", "_APIKEY", "_TOKEN", "_SECRET", "_PASSWORD", "_CREDENTIALS"];
    const PREFIXES: &[&str] = &[
        "AWS_", "AZURE_", "GOOGLE_", "GCP_", "OPENAI_", "ANTHROPIC_", "GEMINI_", "DEEPSEEK_",
        "MOONSHOT_", "QWEN_", "GROQ_", "MISTRAL_", "PI_",
    ];
    const EXACT: &[&str] = &["GITHUB_TOKEN", "GH_TOKEN", "NPM_TOKEN", "PYPI_TOKEN", "HF_TOKEN", "SSH_AUTH_SOCK"];
    SUFFIXES.iter().any(|item| upper.ends_with(item))
        || PREFIXES.iter().any(|item| upper.starts_with(item))
        || EXACT.contains(&upper.as_str())
}

fn merge_sandbox_env(host_env: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = host_env
        .iter()
        .filter(|(key, _)| !is_credential_var(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    for key in PROFILE_SCOPED_VARS {
        match std::env::var(key) {
            Ok(value) => { env.insert((*key).to_string(), value); }
            // 沙箱账户没有该变量时宁可移除，也不要留下指向调用者目录的值。
            Err(_) => { env.remove(*key); }
        }
    }
    // 沙箱账户的 HOMEPATH 往往是 \Windows\system32（建账户时没指定家目录），
    // 与 USERPROFILE 互相矛盾：bash -lc 会按这些值去找 .bash_profile，
    // 落到读不了或不该读的位置，每条命令都多打一行 Permission denied。
    // 统一对齐到沙箱账户自己的 profile，这是它唯一有写权限的家目录。
    if let Some(profile) = env.get("USERPROFILE").cloned() {
        env.insert("HOME".to_string(), profile.clone());
        if profile.len() >= 2 && profile.as_bytes()[1] == b':' {
            env.insert("HOMEDRIVE".to_string(), profile[..2].to_string());
            env.insert("HOMEPATH".to_string(), profile[2..].to_string());
        }
    }
    env
}

/// 定位 Git for Windows 的 bash：安装位置因人而异，逐级回退而不是写死 Program Files。
fn resolve_bash(env: &BTreeMap<String, String>) -> Option<String> {
    let exists = |path: &str| std::path::Path::new(path).exists();
    if let Some(explicit) = env.get("FASTAGENT_SANDBOX_BASH") {
        if exists(explicit) {
            return Some(explicit.clone());
        }
    }
    let path_value = env
        .get("PATH")
        .or_else(|| env.get("Path"))
        .cloned()
        .unwrap_or_default();
    for dir in path_value.split(';').filter(|item| !item.is_empty()) {
        let direct = format!("{}\\bash.exe", dir.trim_end_matches('\\'));
        // System32\bash.exe 是 WSL 启动器，不是 Git Bash，命中它会把命令送进另一个子系统。
        if exists(&direct) && !direct.to_lowercase().contains("\\windows\\system32") {
            return Some(direct);
        }
        // PATH 里通常只有 Git 的 cmd 目录，从 git.exe 反推同一安装下的 bash。
        let git = format!("{}\\git.exe", dir.trim_end_matches('\\'));
        if exists(&git) {
            let base = std::path::Path::new(dir).parent().map(|value| value.to_path_buf());
            if let Some(base) = base {
                for suffix in ["bin\\bash.exe", "usr\\bin\\bash.exe"] {
                    let candidate = base.join(suffix);
                    if candidate.exists() {
                        return Some(candidate.display().to_string());
                    }
                }
            }
        }
    }
    let roots = [
        std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into()),
        std::env::var("ProgramW6432").unwrap_or_else(|_| "C:\\Program Files".into()),
        format!(
            "{}\\Programs",
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\".into())
        ),
    ];
    roots
        .iter()
        .map(|root| format!("{root}\\Git\\bin\\bash.exe"))
        .find(|path| exists(path))
}

/// 命令行拼装：沙箱内不复用 Host 的 shell 解析，按会话声明的 shell 明确构造。
fn build_command_line(session: &SessionArgs, command: &str, env: &BTreeMap<String, String>) -> Result<Vec<u16>> {
    if session.shell == "powershell" {
        // 命令用 base64 传递而不是内联拼接：内联时整段脚本要先通过 PowerShell 解析器，
        // 命令里一个 `&&`（5.1 不支持）就让 OutputEncoding 那句还没执行就整体解析失败，
        // 错误按控制台代码页写出去，Host 按 UTF-8 读到的是乱码甚至空输出。
        // 走 Invoke-Expression 后外层脚本恒定可解析，编码先生效，命令自身的语法错误
        // 变成可读的运行期错误。顺带绕开了命令内引号与反斜杠的转义问题。
        //
        // 退出码要自己收敛：Invoke-Expression 成功执行了一条失败的命令，自身仍算成功，
        // 不显式 exit 的话失败命令会报 0，Host 侧变成静默成功。
        // 按 LASTEXITCODE（原生程序真实退出码）→ $? → $Error 计数（cmdlet 的非终止错误）逐级判定。
        let encoded = STANDARD.encode(command.as_bytes());
        // 显式设成 UTF-8：PowerShell 5.1 在管道重定向下默认输出 UTF-16，Host 侧会读成乱码。
        return Ok(to_wide(&format!(
            "powershell.exe -NoLogo -NoProfile -NonInteractive -Command {}",
            quote(&format!(
                "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \
                 $ErrorActionPreference='Continue'; $global:LASTEXITCODE=0; $Error.Clear(); \
                 try {{ Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded}'))); $faOk=$? }} \
                 catch {{ [Console]::Error.WriteLine(($_ | Out-String)); exit 1 }}; \
                 if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; \
                 if (-not $faOk -or $Error.Count -gt 0) {{ exit 1 }}; exit 0"
            ))
        )));
    }
    match resolve_bash(env) {
        Some(path) => Ok(to_wide(&format!("\"{path}\" -lc {}", quote(command)))),
        None => Err(SandboxCoreError::new("沙箱内找不到 bash（需要安装 Git for Windows）")),
    }
}

fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[allow(clippy::too_many_arguments)]
fn spawn_command(
    session: &SessionArgs,
    writer: &Arc<Writer>,
    registry: &Registry,
    id: String,
    command: String,
    cwd: String,
    env: BTreeMap<String, String>,
    timeout_ms: u64,
) -> Result<()> {
    let env = merge_sandbox_env(&env);
    let mut command_line = build_command_line(session, &command, &env)?;
    let (stdout_read, stdout_write) = create_pipe(true)?;
    let (stderr_read, stderr_write) = create_pipe(true)?;
    let (stdin_read, stdin_write) = create_pipe(false)?;

    let job = create_job(session.max_processes)?;
    let token = restricted_token();
    let mut environment = environment_block(&env);
    let directory = to_wide(&cwd);

    let startup = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTF_USESTDHANDLES,
        hStdInput: stdin_read.raw(),
        hStdOutput: stdout_write.raw(),
        hStdError: stderr_write.raw(),
        ..Default::default()
    };
    let mut information = PROCESS_INFORMATION::default();
    let flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP;

    // 先按受限令牌创建；令牌降权不可用时退回沙箱账户自身令牌，并在 stderr 明确说明，
    // 不做静默的安全弱化。
    let created = match &token {
        Some(restricted) => unsafe {
            CreateProcessAsUserW(
                Some(restricted.raw()),
                None,
                Some(windows::core::PWSTR(command_line.as_mut_ptr())),
                None,
                None,
                true,
                flags,
                Some(environment.as_mut_ptr() as *mut _),
                windows::core::PCWSTR(directory.as_ptr()),
                &startup,
                &mut information,
            )
        },
        None => Err(windows::core::Error::empty()),
    };
    let created = match created {
        Ok(()) => Ok(()),
        Err(_) => {
            writer.chunk(
                &id,
                "stderr",
                b"[FastAgent] restricted token unavailable; command runs under the sandbox account without extra privilege stripping.\n",
            );
            unsafe {
                CreateProcessAsUserW(
                    None,
                    None,
                    Some(windows::core::PWSTR(command_line.as_mut_ptr())),
                    None,
                    None,
                    true,
                    flags,
                    Some(environment.as_mut_ptr() as *mut _),
                    windows::core::PCWSTR(directory.as_ptr()),
                    &startup,
                    &mut information,
                )
            }
        }
    };
    created.map_err(|error| SandboxCoreError::with("在沙箱内启动命令失败", error))?;

    // 挂起态先入 Job，保证子孙进程无一例外落在同一个安全上下文与生命周期里。
    unsafe {
        AssignProcessToJobObject(job, information.hProcess)
            .map_err(|error| SandboxCoreError::with("加入 Job Object 失败", error))?;
        ResumeThread(information.hThread);
        let _ = CloseHandle(information.hThread);
    }
    drop(stdout_write);
    drop(stderr_write);
    drop(stdin_read);

    let stdin_handle = Arc::new(stdin_write);
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = registry.lock() {
        map.insert(id.clone(), RunningProcess { job, stdin: stdin_handle.clone(), cancelled: cancelled.clone() });
    }
    writer.send(&Response::Started { id: id.clone(), pid: information.dwProcessId });

    let stdout_pump = spawn_pump(writer.clone(), id.clone(), stdout_read, "stdout");
    let stderr_pump = spawn_pump(writer.clone(), id.clone(), stderr_read, "stderr");

    let process = SendHandle(information.hProcess);
    let job_handle = SendHandle(job);
    let writer_for_wait = writer.clone();
    let registry_for_wait = registry.clone();
    std::thread::spawn(move || {
        let process = process.get();
        let job = job_handle.get();
        let wait = if timeout_ms == 0 { INFINITE } else { timeout_ms as u32 };
        let status = unsafe { WaitForSingleObject(process, wait) };
        let timed_out = status == WAIT_TIMEOUT;
        if timed_out {
            unsafe { let _ = TerminateJobObject(job, 1); }
            unsafe { WaitForSingleObject(process, 5_000) };
        }
        let mut code = 0u32;
        let exit_code = unsafe { GetExitCodeProcess(process, &mut code) }.ok().map(|_| code as i32);
        if let Ok(mut map) = registry_for_wait.lock() {
            map.remove(&id);
        }
        unsafe {
            let _ = CloseHandle(process);
            // 关闭 Job 句柄触发 KILL_ON_JOB_CLOSE，回收命令派生的后台进程。
            let _ = CloseHandle(job);
        }
        // 先等待输出管道读完，再发结束帧，避免调用方看到退出后仍丢失尾部输出。
        let _ = stdout_pump.join();
        let _ = stderr_pump.join();
        if timed_out {
            writer_for_wait.send(&Response::Error { id, code: "timeout".into(), target: Some(format!("{timeout_ms}ms")) });
        } else {
            let reason = if cancelled.load(Ordering::Acquire) { "cancelled" } else { "completed" };
            writer_for_wait.send(&Response::Exited { id, exit_code, reason: Some(reason.into()) });
        }
    });
    Ok(())
}

fn spawn_pump(writer: Arc<Writer>, id: String, handle: OwnedHandle, stream: &'static str) -> JoinHandle<()> {
    std::thread::spawn(move || {
        pump(&handle, |chunk| writer.chunk(&id, stream, chunk));
    })
}

fn create_job(max_processes: u32) -> Result<HANDLE> {
    let job = unsafe { CreateJobObjectW(None, None) }
        .map_err(|error| SandboxCoreError::with("创建 Job Object 失败", error))?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    limits.BasicLimitInformation.ActiveProcessLimit = max_processes.max(1);
    unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|error| SandboxCoreError::with("配置 Job Object 限制失败", error))?;
    }
    Ok(job)
}

/// 由 worker 自身令牌派生的受限令牌：删除全部特权。
/// 这是标准用户可用的唯一降权路径（受限令牌无需 SE_ASSIGNPRIMARYTOKEN）。
fn restricted_token() -> Option<OwnedHandle> {
    let mut token = HANDLE::default();
    unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY,
            &mut token,
        )
        .ok()?;
    }
    let source = OwnedHandle(token);
    let mut restricted = HANDLE::default();
    let created = unsafe {
        CreateRestrictedToken(
            source.raw(),
            DISABLE_MAX_PRIVILEGE,
            None,
            None,
            None,
            &mut restricted,
        )
    };
    created.ok()?;
    Some(OwnedHandle(restricted))
}

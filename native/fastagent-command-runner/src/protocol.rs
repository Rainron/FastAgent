use std::collections::BTreeMap;
use std::io::Write;
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

/// Host → runner 的会话参数，由 windows-sandbox-policy.ts 构造。
/// 部分字段当前只做记录与排障，保留完整结构以便协议演进。
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct SessionArgs {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub account: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: Option<String>,
    #[serde(rename = "networkMode")]
    pub network_mode: String,
    #[serde(default)]
    pub shell: String,
    #[serde(rename = "maxProcesses", default = "default_max_processes")]
    pub max_processes: u32,
    #[serde(rename = "timeoutMs", default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_max_processes() -> u32 {
    64
}

fn default_timeout() -> u64 {
    600_000
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum Request {
    #[serde(rename = "exec")]
    Exec {
        id: String,
        command: String,
        cwd: String,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(rename = "timeoutMs")]
        timeout_ms: Option<u64>,
    },
    #[serde(rename = "stdin")]
    Stdin { id: String, data: String },
    #[serde(rename = "cancel")]
    Cancel { id: String },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum Response {
    #[serde(rename = "ready")]
    Ready { session: String, account: String },
    #[serde(rename = "started")]
    Started { id: String, pid: u32 },
    #[serde(rename = "stdout")]
    Stdout { id: String, data: String },
    #[serde(rename = "stderr")]
    Stderr { id: String, data: String },
    #[serde(rename = "exited")]
    Exited {
        id: String,
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        id: String,
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        target: Option<String>,
    },
}

/// stdout 是多个泵送线程共享的唯一出口，必须整帧串行写出。
pub struct Writer {
    inner: Mutex<()>,
}

impl Writer {
    pub fn new() -> Self {
        Self { inner: Mutex::new(()) }
    }

    pub fn send(&self, response: &Response) {
        let Ok(line) = serde_json::to_string(response) else { return };
        let _guard = self.inner.lock();
        let stdout = std::io::stdout();
        let mut handle = stdout.lock();
        let _ = handle.write_all(line.as_bytes());
        let _ = handle.write_all(b"\n");
        let _ = handle.flush();
    }

    pub fn chunk(&self, id: &str, stream: &str, bytes: &[u8]) {
        let data = STANDARD.encode(bytes);
        let response = if stream == "stderr" {
            Response::Stderr { id: id.to_string(), data }
        } else {
            Response::Stdout { id: id.to_string(), data }
        };
        self.send(&response);
    }
}

pub fn decode_base64(value: &str) -> Vec<u8> {
    STANDARD.decode(value).unwrap_or_default()
}

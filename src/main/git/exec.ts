import { execFile } from 'node:child_process'

/** 单条 git 命令超时，避免仓库异常时把 IPC 和 UI 卡死。 */
export const GIT_TIMEOUT_MS = 5000

/** 网络类命令（fetch/pull/push）慢得多，单独放宽超时。 */
export const GIT_NETWORK_TIMEOUT_MS = 60000

export interface GitExecResult {
  code: number
  stdout: string
  stderr: string
  /** git 可执行文件不存在（PATH 里没有 git）。 */
  missing: boolean
}

/**
 * 在 root 下执行 git。参数走 execFile 数组，天然避免 shell 注入；
 * 任何异常（超时/权限/git 缺失）都收敛成结构化结果，由调用方决定如何降级。
 */
export function execGit(root: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitExecResult> {
  return new Promise((resolve) => {
    // 大仓库的 log/diff 输出可能远超默认 1MB 上限，超了会被当作错误截断。
    // encoding: 'buffer' 让 Node 返回原始字节；下游统一按 UTF-8 解码：
    // Windows 上 execFile 即便传 encoding: 'utf8' 也仍按系统 ANSI 代码页解码子进程输出，
    // 路径、提交信息里的中文会被打回成乱码，这里手动 toString('utf8') 才能拿到真正的 UTF-8。
    // -c core.quotePath=false 让 git 直接输出 UTF-8 路径，不再转义为 \344\270\255 这种八进制序列。
    execFile('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, timeout: timeoutMs, windowsHide: true, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) { resolve({ code: 0, stdout: decodeUtf8(stdout), stderr: decodeUtf8(stderr), missing: false }); return }
      const errno = (error as NodeJS.ErrnoException | null)?.code
      if (errno === 'ENOENT') { resolve({ code: -1, stdout: '', stderr: '', missing: true }); return }
      // 超时错误码是 'ETIMEDOUT'，其余是 git 自身非零退出（code 为数字）。
      const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1
      resolve({ code, stdout: decodeUtf8(stdout), stderr: decodeUtf8(stderr ?? error.message), missing: false })
    })
  })
}

/** 失败原因取 stderr，回退 stdout，再回退调用方给的兜底文案。 */
export function failureReason(result: GitExecResult, fallback: string): string {
  if (result.missing) return '找不到 git 可执行文件，请确认已安装并在 PATH 中'
  return result.stderr.trim() || result.stdout.trim() || fallback
}

/** 把子进程原始字节按 UTF-8 解码；非 Buffer 输入（错误消息等）按 string 原样返回。 */
function decodeUtf8(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return String(value ?? '')
}

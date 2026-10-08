/** 输入框 `!命令` 直接执行 shell 的请求与结果；与 agent 的 shell 工具共用同一条执行后端。 */

/** 命令输出的落点。默认 local：只在对话区展示，不进模型上下文。 */
export type ShellCommandOutputMode = 'local' | 'context' | 'composer'

export interface ShellCommandSettings {
  /** 关掉之后 `!` 只是普通文本，照常发给模型 */
  enabled: boolean
  output: ShellCommandOutputMode
  /** 单条命令的执行上限，超时按 timeout 收尾 */
  timeoutSeconds: number
}

export interface ShellCommandRequest {
  /** 渲染进程生成，用来对上流式输出与取消 */
  id: string
  command: string
}

export type ShellCommandStatus = 'completed' | 'failed' | 'cancelled' | 'timeout'

export interface ShellCommandResult {
  id: string
  command: string
  status: ShellCommandStatus
  exitCode: number | null
  /** 完整输出（stdout 与 stderr 合流），已按上限从头部截断 */
  output: string
  truncated: boolean
  /** 执行失败时的原因；正常退出为 null */
  error: string | null
  cwd: string
  shell: 'bash' | 'powershell'
  durationMs: number
}

export interface ShellCommandChunk {
  id: string
  chunk: string
}

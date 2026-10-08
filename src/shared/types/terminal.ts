/** 内嵌终端：渲染进程只拿会话描述与字节流，pty 生命周期全在主进程。 */

export interface TerminalSessionInfo {
  id: string
  pid: number
  /** 实际拉起的可执行文件，面板标题用它区分 powershell / bash。 */
  shell: string
  cwd: string
  cols: number
  rows: number
}

export interface TerminalChunk {
  id: string
  data: string
}

export interface TerminalExit {
  id: string
  exitCode: number
  signal?: number
}

/** 重新挂载已有会话：面板关掉或界面重载期间的输出由主进程缓冲，挂上来时一次补齐。 */
export interface TerminalAttachment {
  session: TerminalSessionInfo
  backlog: string
}

export interface TerminalCreateOptions {
  cwd?: string | null
  cols?: number
  rows?: number
}

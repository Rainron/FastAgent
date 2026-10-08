import { randomUUID } from 'node:crypto'
import type { TerminalAttachment, TerminalSessionInfo } from '../../shared/types'

/**
 * 内嵌终端的 pty 会话管理。
 *
 * 会话活在主进程，不随面板开关或界面重载结束：关掉面板再打开，用户期望看到的是
 * 原来那个 shell 和它的历史输出，而不是一个新进程。断开期间的输出留在环形缓冲里，
 * 重新挂载时一次补齐。
 */

export interface PtyProcess {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (chunk: string) => void): void
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
}

export interface PtySpawnOptions {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: NodeJS.ProcessEnv
}

export interface TerminalManagerDeps {
  spawn(options: PtySpawnOptions): PtyProcess
  /** shell 与参数由调用方按平台与设置决定，管理器不认识平台差异。 */
  resolveShell(): { file: string; args: string[] }
  defaultCwd(): string
  env(): NodeJS.ProcessEnv
  onData(chunk: { id: string; data: string }): void
  onExit(event: { id: string; exitCode: number; signal?: number }): void
}

/** 缓冲上限按「够回放一屏历史」定；再大意义不大，却会让每个会话常驻几 MB。 */
export const TERMINAL_BACKLOG_LIMIT = 256 * 1024
/** 同时活着的会话数上限，挡住反复点开新终端把机器占满。 */
export const TERMINAL_MAX_SESSIONS = 8
const MIN_COLS = 2
const MIN_ROWS = 1
const MAX_COLS = 1000
const MAX_ROWS = 1000

type Session = {
  info: TerminalSessionInfo
  pty: PtyProcess
  backlog: string
  exited: boolean
}

/** 小于下限的尺寸按「没给」处理：1 行 1 列的终端没有意义，多半是界面还没量出布局。 */
function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) return fallback
  return Math.min(max, Math.round(value))
}

export class TerminalManager {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: TerminalManagerDeps) {}

  list(): TerminalSessionInfo[] {
    return [...this.sessions.values()].filter((session) => !session.exited).map((session) => ({ ...session.info }))
  }

  create(options: { cwd?: string | null; cols?: number; rows?: number } = {}): TerminalSessionInfo {
    if (this.list().length >= TERMINAL_MAX_SESSIONS) throw new Error(`最多同时开 ${TERMINAL_MAX_SESSIONS} 个终端`)
    const shell = this.deps.resolveShell()
    const cwd = options.cwd?.trim() || this.deps.defaultCwd()
    const cols = clamp(options.cols, 80, MIN_COLS, MAX_COLS)
    const rows = clamp(options.rows, 24, MIN_ROWS, MAX_ROWS)
    const pty = this.deps.spawn({ file: shell.file, args: shell.args, cwd, cols, rows, env: this.deps.env() })
    const id = randomUUID()
    const session: Session = { info: { id, pid: pty.pid, shell: shell.file, cwd, cols, rows }, pty, backlog: '', exited: false }
    this.sessions.set(id, session)
    pty.onData((chunk) => {
      session.backlog = appendBacklog(session.backlog, chunk)
      this.deps.onData({ id, data: chunk })
    })
    pty.onExit((event) => {
      session.exited = true
      this.sessions.delete(id)
      this.deps.onExit({ id, exitCode: event.exitCode, ...(event.signal === undefined ? {} : { signal: event.signal }) })
    })
    return { ...session.info }
  }

  /** 面板挂上来时补齐断开期间的输出；会话已退出时返回 null，由界面决定是否新建。 */
  attach(id: string): TerminalAttachment | null {
    const session = this.sessions.get(id)
    if (!session || session.exited) return null
    return { session: { ...session.info }, backlog: session.backlog }
  }

  write(id: string, data: string): void {
    const session = this.require(id)
    session.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.require(id)
    const next = { cols: clamp(cols, session.info.cols, MIN_COLS, MAX_COLS), rows: clamp(rows, session.info.rows, MIN_ROWS, MAX_ROWS) }
    if (next.cols === session.info.cols && next.rows === session.info.rows) return
    session.info = { ...session.info, ...next }
    session.pty.resize(next.cols, next.rows)
  }

  /** 关会话：kill 后仍等 onExit 清表，避免 pty 还在收尾时表里已经没有它。 */
  close(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    try {
      session.pty.kill()
    } catch {
      // 进程可能已经自己退了，清表由 onExit 负责，这里不该抛
    }
    return true
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
    this.sessions.clear()
  }

  private require(id: string): Session {
    const session = this.sessions.get(id)
    if (!session || session.exited) throw new Error('终端会话不存在或已结束')
    return session
  }
}

/** 只保留尾部：终端历史越靠后越有用，超限时砍掉最前面的。 */
export function appendBacklog(current: string, chunk: string, limit = TERMINAL_BACKLOG_LIMIT): string {
  const next = current + chunk
  return next.length <= limit ? next : next.slice(next.length - limit)
}

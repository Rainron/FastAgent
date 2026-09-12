import { randomUUID } from 'node:crypto'
import { SandboxError, type SandboxErrorCode } from '../../sandbox-errors'
import type { SandboxExecuteRequest, SandboxProcess } from '../../sandbox-types'

export type RunnerRequest =
  | { type: 'exec'; id: string; command: string; cwd: string; env: Record<string, string>; timeoutMs?: number }
  | { type: 'stdin'; id: string; data: string }
  | { type: 'cancel'; id: string }

export type RunnerResponse =
  | { type: 'ready'; session: string; account: string }
  | { type: 'started'; id: string; pid: number }
  | { type: 'stdout'; id: string; data: string }
  | { type: 'stderr'; id: string; data: string }
  | { type: 'exited'; id: string; exitCode: number | null }
  | { type: 'error'; id: string; code: SandboxErrorCode; target?: string }

const RESPONSE_TYPES = new Set(['ready', 'started', 'stdout', 'stderr', 'exited', 'error'])

export function encodeRequest(request: RunnerRequest): string {
  return `${JSON.stringify(request)}\n`
}

/**
 * JSONL 帧解析：runner 的 stdout 可能在任意字节处被切分，
 * 未闭合的行留在缓冲区等下一块；非法行丢弃而不是让整个会话崩掉。
 */
export class RunnerFrameParser {
  private buffer = ''
  readonly invalidFrames: string[] = []

  push(chunk: Buffer | string): RunnerResponse[] {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const frames: RunnerResponse[] = []
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) {
        const parsed = this.parseLine(line)
        if (parsed) frames.push(parsed)
      }
      index = this.buffer.indexOf('\n')
    }
    return frames
  }

  private parseLine(line: string): RunnerResponse | null {
    try {
      const value = JSON.parse(line) as { type?: unknown; id?: unknown; session?: unknown }
      if (typeof value?.type !== 'string' || !RESPONSE_TYPES.has(value.type)) {
        this.invalidFrames.push(line)
        return null
      }
      // ready 是会话级握手，没有 id；其余帧必须能对上某条命令。
      const identified = value.type === 'ready' ? typeof value.session === 'string' : typeof value.id === 'string'
      if (!identified) {
        this.invalidFrames.push(line)
        return null
      }
      return value as unknown as RunnerResponse
    } catch {
      this.invalidFrames.push(line)
      return null
    }
  }
}

/** runner 进程的最小抽象：便于在测试里替换真实子进程。 */
export interface RunnerHandle {
  write(payload: string): void
  onData(listener: (chunk: Buffer) => void): void
  onClose(listener: (code: number | null) => void): void
  kill(): void
}

interface PendingProcess {
  resolve: (result: { exitCode: number | null }) => void
  reject: (error: unknown) => void
  onData: SandboxExecuteRequest['onData']
  settled: boolean
}

/** runner 建立沙箱身份需要一次 Secondary Logon，给足余量但不能无限等。 */
const READY_TIMEOUT_MS = 20_000

/** 一个沙箱会话对应一个常驻 runner，多条命令按 id 复用同一进程。 */
export class RunnerClient {
  private readonly parser = new RunnerFrameParser()
  private readonly pending = new Map<string, PendingProcess>()
  private closed = false
  private settleReady: ((error?: unknown) => void) | null = null
  /** 握手结果：runner 起不来时在这里就失败，不留到第一条命令。 */
  readonly ready: Promise<void>

  constructor(private readonly handle: RunnerHandle) {
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new SandboxError('runner_failed')), READY_TIMEOUT_MS)
      this.settleReady = (error?: unknown) => {
        clearTimeout(timer)
        this.settleReady = null
        if (error) reject(error)
        else resolve()
      }
    })
    // 未消费的 ready 拒绝不应该变成 unhandled rejection。
    void this.ready.catch(() => undefined)

    handle.onData((chunk) => {
      for (const frame of this.parser.push(chunk)) this.dispatch(frame)
    })
    handle.onClose(() => {
      this.closed = true
      this.settleReady?.(new SandboxError('runner_failed'))
      for (const [id, entry] of this.pending) {
        if (!entry.settled) entry.reject(new SandboxError('runner_failed'))
        this.pending.delete(id)
      }
    })
  }

  async exec(request: SandboxExecuteRequest): Promise<SandboxProcess> {
    if (this.closed) throw new SandboxError('runner_failed')
    const id = randomUUID()
    let settle: PendingProcess | null = null
    const exit = new Promise<{ exitCode: number | null }>((resolve, reject) => {
      settle = { resolve, reject, onData: request.onData, settled: false }
    })
    this.pending.set(id, settle as unknown as PendingProcess)
    const abort = () => { this.cancel(id) }
    request.signal?.addEventListener('abort', abort, { once: true })
    void exit.catch(() => undefined).finally(() => request.signal?.removeEventListener('abort', abort))
    this.handle.write(encodeRequest({
      type: 'exec',
      id,
      command: request.command,
      cwd: request.cwd,
      env: request.env,
      timeoutMs: request.timeoutMs
    }))
    return { id, exit }
  }

  cancel(processId: string) {
    if (this.closed) return
    this.handle.write(encodeRequest({ type: 'cancel', id: processId }))
  }

  dispose() {
    this.closed = true
    this.settleReady?.(new SandboxError('runner_failed'))
    this.handle.kill()
  }

  private dispatch(frame: RunnerResponse) {
    if (frame.type === 'ready') {
      this.settleReady?.()
      return
    }
    const entry = this.pending.get(frame.id)
    if (!entry) return
    if (frame.type === 'stdout' || frame.type === 'stderr') {
      entry.onData(Buffer.from(frame.data, 'base64'), frame.type)
      return
    }
    if (frame.type === 'exited') {
      entry.settled = true
      this.pending.delete(frame.id)
      entry.resolve({ exitCode: frame.exitCode })
      return
    }
    if (frame.type === 'error') {
      entry.settled = true
      this.pending.delete(frame.id)
      entry.reject(new SandboxError(frame.code, { target: frame.target }))
    }
  }
}

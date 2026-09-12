import type { SandboxPolicy, SandboxStatus } from '../../../shared/sandbox'
import type { SandboxErrorCode } from './sandbox-errors'

export interface SandboxCapabilities {
  status: SandboxStatus
  runnerVersion: string | null
  setupVersion: string | null
  accounts: { offline: boolean; online: boolean }
  reason: SandboxErrorCode | null
  checkedAt: number
}

export interface SandboxCreateOptions {
  workspacePath: string | null
  policy: SandboxPolicy
  /** 沙箱内用哪个 shell 解释命令；与 AppSettings.shellPreference 一致 */
  shell: 'bash' | 'powershell'
}

export interface SandboxSession {
  id: string
  workspacePath: string | null
  accountMode: 'offline' | 'online'
  policy: SandboxPolicy
  /** unsandboxed 只在用户显式允许降级或沙箱关闭时出现 */
  isolation: 'sandboxed' | 'unsandboxed'
  createdAt: number
}

export type SandboxStream = 'stdout' | 'stderr'

export interface SandboxExecuteRequest {
  command: string
  cwd: string
  env: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  onData: (chunk: Buffer, stream: SandboxStream) => void
}

export interface SandboxProcess {
  id: string
  exit: Promise<{ exitCode: number | null }>
}

export interface SandboxProvider {
  probe(): Promise<SandboxCapabilities>
  /** 触发一次性初始化（需要管理员权限），返回初始化后的能力。 */
  initialize(): Promise<SandboxCapabilities>
  createSession(options: SandboxCreateOptions): Promise<SandboxSession>
  execute(session: SandboxSession, request: SandboxExecuteRequest): Promise<SandboxProcess>
  terminate(session: SandboxSession, processId: string): Promise<void>
  destroySession(session: SandboxSession): Promise<void>
}

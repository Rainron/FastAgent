import { accountModeFor, type SandboxPolicy } from '../../../shared/sandbox'
import { SandboxError } from './sandbox-errors'
import type {
  SandboxCapabilities,
  SandboxCreateOptions,
  SandboxExecuteRequest,
  SandboxProcess,
  SandboxProvider,
  SandboxSession
} from './sandbox-types'

/** 能力探测缓存时长：probe 会启动外部程序，不适合每轮 Agent 都跑一次。 */
const PROBE_TTL_MS = 30_000

export class SandboxManager {
  private capabilities: SandboxCapabilities | null = null
  private probing: Promise<SandboxCapabilities> | null = null
  private readonly processes = new Map<string, Set<SandboxProcess>>()
  private readonly sessions = new Map<string, SandboxSession>()

  constructor(private readonly provider: SandboxProvider, private readonly now: () => number = () => Date.now()) {}

  async probe(force = false): Promise<SandboxCapabilities> {
    if (!force && this.capabilities && this.now() - this.capabilities.checkedAt < PROBE_TTL_MS) return this.capabilities
    if (!force && this.probing) return this.probing
    this.probing = this.provider.probe()
      .then((result) => {
        this.capabilities = result
        return result
      })
      .finally(() => { this.probing = null })
    return this.probing
  }

  /** 缓存值仅供 UI 立即渲染；判定是否放行执行一律走 probe()。 */
  cachedCapabilities(): SandboxCapabilities | null {
    return this.capabilities
  }

  async initialize(): Promise<SandboxCapabilities> {
    const result = await this.provider.initialize()
    this.capabilities = result
    return result
  }

  /**
   * 沙箱关闭时返回 unsandboxed 会话；开启但不可用时抛错。
   * 只有 allowUnsandboxedFallback 显式为 true 才允许降级，禁止静默回退。
   */
  async createSession(options: SandboxCreateOptions): Promise<SandboxSession> {
    const policy = options.policy
    if (!policy.enabled) return this.register(this.localSession(options, policy))
    const capabilities = await this.probe()
    if (capabilities.status !== 'ready') {
      if (!policy.process.allowUnsandboxedFallback) throw new SandboxError(capabilities.reason ?? 'broken')
      return this.register(this.localSession(options, policy))
    }
    const session = await this.provider.createSession(options)
    return this.register(session)
  }

  async execute(session: SandboxSession, request: SandboxExecuteRequest): Promise<SandboxProcess> {
    if (session.isolation !== 'sandboxed') throw new SandboxError('broken')
    const process = await this.provider.execute(session, request)
    const bucket = this.processes.get(session.id) ?? new Set<SandboxProcess>()
    bucket.add(process)
    this.processes.set(session.id, bucket)
    void process.exit.catch(() => undefined).finally(() => { bucket.delete(process) })
    return process
  }

  async terminate(session: SandboxSession, processId: string): Promise<void> {
    if (session.isolation !== 'sandboxed') return
    await this.provider.terminate(session, processId)
  }

  async destroySession(session: SandboxSession): Promise<void> {
    this.sessions.delete(session.id)
    const bucket = this.processes.get(session.id)
    this.processes.delete(session.id)
    if (session.isolation !== 'sandboxed') return
    for (const item of bucket ?? []) {
      await this.provider.terminate(session, item.id).catch(() => undefined)
    }
    await this.provider.destroySession(session)
  }

  /** 应用退出与「停止全部任务」时统一清场，避免残留沙箱进程。 */
  async destroyAll(): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      await this.destroySession(session).catch(() => undefined)
    }
  }

  activeSession(): SandboxSession | null {
    const sessions = [...this.sessions.values()]
    return sessions.length ? sessions[sessions.length - 1] : null
  }

  private register(session: SandboxSession): SandboxSession {
    this.sessions.set(session.id, session)
    return session
  }

  private localSession(options: SandboxCreateOptions, policy: SandboxPolicy): SandboxSession {
    return {
      id: `sandbox-local-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspacePath: options.workspacePath,
      accountMode: accountModeFor(policy),
      policy,
      isolation: 'unsandboxed',
      createdAt: this.now()
    }
  }
}

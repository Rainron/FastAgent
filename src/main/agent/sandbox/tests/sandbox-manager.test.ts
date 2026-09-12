import { describe, expect, it, vi } from 'vitest'
import { defaultSandboxSettings, resolveSandboxPolicy, type SandboxPolicy } from '../../../../shared/sandbox'
import { SandboxManager } from '../sandbox-manager'
import { isSandboxError } from '../sandbox-errors'
import type { SandboxCapabilities, SandboxProcess, SandboxProvider, SandboxSession } from '../sandbox-types'

function capabilities(patch: Partial<SandboxCapabilities> = {}): SandboxCapabilities {
  return {
    status: 'ready',
    runnerVersion: '0.1.0',
    setupVersion: '0.1.0',
    accounts: { offline: true, online: true },
    reason: null,
    checkedAt: 1,
    ...patch
  }
}

function fakeProvider(overrides: Partial<SandboxProvider> = {}) {
  const terminate = vi.fn(async () => undefined)
  const destroySession = vi.fn(async () => undefined)
  const provider: SandboxProvider = {
    probe: async () => capabilities(),
    initialize: async () => capabilities(),
    createSession: async (options) => ({
      id: 'sandbox-1',
      workspacePath: options.workspacePath,
      accountMode: 'online',
      policy: options.policy,
      isolation: 'sandboxed',
      createdAt: 1
    }),
    execute: async () => ({ id: 'p1', exit: Promise.resolve({ exitCode: 0 }) }),
    terminate,
    destroySession,
    ...overrides
  }
  return { provider, terminate, destroySession }
}

function policyOf(patch: Partial<typeof defaultSandboxSettings> = {}): SandboxPolicy {
  return resolveSandboxPolicy({ ...defaultSandboxSettings, ...patch }, { workspacePath: 'D:\\work', home: 'C:\\Users\\lake' })
}

describe('SandboxManager.createSession', () => {
  it('沙箱可用时返回受限会话', async () => {
    const { provider } = fakeProvider()
    const manager = new SandboxManager(provider)
    const session = await manager.createSession({ workspacePath: 'D:\\work', policy: policyOf(), shell: 'bash' })
    expect(session.isolation).toBe('sandboxed')
  })

  it('沙箱关闭时直接返回本地会话', async () => {
    const createSession = vi.fn()
    const { provider } = fakeProvider({ createSession })
    const manager = new SandboxManager(provider)
    const session = await manager.createSession({ workspacePath: null, policy: policyOf({ enabled: false }), shell: 'bash' })
    expect(session.isolation).toBe('unsandboxed')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('沙箱未初始化且不允许降级时抛出对应错误，不创建会话', async () => {
    const createSession = vi.fn()
    const { provider } = fakeProvider({ probe: async () => capabilities({ status: 'not_initialized', reason: 'not_initialized' }), createSession })
    const manager = new SandboxManager(provider)
    await expect(manager.createSession({ workspacePath: null, policy: policyOf(), shell: 'bash' })).rejects.toSatisfy(
      (error: unknown) => isSandboxError(error) && error.code === 'not_initialized'
    )
    expect(createSession).not.toHaveBeenCalled()
  })

  it('显式允许降级时才回退到本地会话', async () => {
    const { provider } = fakeProvider({ probe: async () => capabilities({ status: 'broken', reason: 'broken' }) })
    const manager = new SandboxManager(provider)
    const session = await manager.createSession({ workspacePath: null, policy: policyOf({ allowUnsandboxedFallback: true }), shell: 'bash' })
    expect(session.isolation).toBe('unsandboxed')
  })
})

describe('SandboxManager 执行与清理', () => {
  it('本地会话不允许走沙箱执行通道', async () => {
    const { provider } = fakeProvider()
    const manager = new SandboxManager(provider)
    const session = await manager.createSession({ workspacePath: null, policy: policyOf({ enabled: false }), shell: 'bash' })
    await expect(manager.execute(session, { command: 'ls', cwd: '.', env: {}, onData: () => undefined })).rejects.toThrow()
  })

  it('销毁会话时终止全部未结束的进程', async () => {
    let resolveExit: (value: { exitCode: number | null }) => void = () => undefined
    const pending: SandboxProcess = { id: 'p1', exit: new Promise((resolve) => { resolveExit = resolve }) }
    const { provider, terminate, destroySession } = fakeProvider({ execute: async () => pending })
    const manager = new SandboxManager(provider)
    const session = await manager.createSession({ workspacePath: 'D:\\work', policy: policyOf(), shell: 'bash' })
    await manager.execute(session, { command: 'npm test', cwd: 'D:\\work', env: {}, onData: () => undefined })
    await manager.destroySession(session)
    expect(terminate).toHaveBeenCalledWith(session, 'p1')
    expect(destroySession).toHaveBeenCalled()
    resolveExit({ exitCode: 0 })
  })

  it('destroyAll 清空全部登记的会话', async () => {
    const { provider, destroySession } = fakeProvider({
      createSession: async (options): Promise<SandboxSession> => ({
        id: `sandbox-${Math.random()}`,
        workspacePath: options.workspacePath,
        accountMode: 'online',
        policy: options.policy,
        isolation: 'sandboxed',
        createdAt: 1
      })
    })
    const manager = new SandboxManager(provider)
    await manager.createSession({ workspacePath: 'D:\\a', policy: policyOf(), shell: 'bash' })
    await manager.createSession({ workspacePath: 'D:\\b', policy: policyOf(), shell: 'bash' })
    await manager.destroyAll()
    expect(destroySession).toHaveBeenCalledTimes(2)
    expect(manager.activeSession()).toBeNull()
  })

  it('探测结果在 TTL 内复用，force 时强制刷新', async () => {
    const probe = vi.fn(async () => capabilities())
    const { provider } = fakeProvider({ probe })
    const manager = new SandboxManager(provider, () => 1000)
    await manager.probe()
    await manager.probe()
    expect(probe).toHaveBeenCalledTimes(1)
    await manager.probe(true)
    expect(probe).toHaveBeenCalledTimes(2)
  })
})

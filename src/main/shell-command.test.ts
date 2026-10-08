import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSandboxSettings } from '../shared/sandbox'
import { buildSandboxPolicy } from './agent/sandbox/sandbox-policy'
import type { SandboxManager } from './agent/sandbox/sandbox-manager'
import { cancelAllShellCommands, cancelShellCommand, runShellCommand, shellCommandStatus, type ShellCommandDeps } from './shell-command'

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('./agent/sandbox/shell-operations', () => ({ createShellOperations: () => ({ exec }) }))
vi.mock('./agent/sandbox/shell-resolver', () => ({ resolveBashPath: () => null, resolveShellToolName: () => 'powershell' }))

function dependencies() {
  const policy = buildSandboxPolicy(defaultSandboxSettings, 'C:/workspace')
  const session = { id: 'session', isolation: 'sandboxed', workspacePath: 'C:/workspace', policy }
  const manager = { createSession: vi.fn().mockResolvedValue(session), destroySession: vi.fn().mockResolvedValue(undefined) }
  const deps = { shellPreference: 'powershell', bashPath: '', workspaceRoot: 'C:/workspace', policy, manager: manager as unknown as SandboxManager, timeoutSeconds: 1, onData: vi.fn() } as ShellCommandDeps
  return { deps, manager, session }
}

afterEach(() => { cancelAllShellCommands(); vi.useRealTimers(); vi.clearAllMocks() })

describe('runShellCommand', () => {
  it('新命令建立沙箱并在执行结束后销毁', async () => {
    const { deps, manager, session } = dependencies()
    exec.mockResolvedValue({ exitCode: 0 })
    const result = await runShellCommand('test', 'pwd', deps)
    expect(manager.createSession).toHaveBeenCalledWith({ workspacePath: deps.workspaceRoot, policy: deps.policy, shell: 'powershell' })
    expect(manager.destroySession).toHaveBeenCalledWith(session)
    expect(result.status).toBe('completed')
  })

  it('沙箱建立失败禁止降级到本地执行', async () => {
    const { deps, manager } = dependencies()
    manager.createSession.mockRejectedValue(new Error('沙箱不可用'))
    const result = await runShellCommand('test', 'pwd', deps)
    expect(result).toMatchObject({ status: 'failed', error: '沙箱不可用' })
    expect(exec).not.toHaveBeenCalled()
  })

  it('允许降级时在结果和实时输出中明确提示未隔离执行', async () => {
    const { deps, manager, session } = dependencies()
    manager.createSession.mockResolvedValue({ ...session, isolation: 'unsandboxed' })
    exec.mockResolvedValue({ exitCode: 0 })
    const result = await runShellCommand('test', 'pwd', deps)
    expect(result.output).toContain('未隔离')
    expect(deps.onData).toHaveBeenCalledWith(expect.stringContaining('未隔离'))
  })

  it('拒绝同 id 并发，首条命令仍能取消', async () => {
    const { deps } = dependencies()
    let finish!: (value: { exitCode: number }) => void
    exec.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const first = runShellCommand('same', 'pwd', deps)
    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce())
    await expect(runShellCommand('same', 'pwd', deps)).rejects.toThrow('正在执行')
    expect(cancelShellCommand('same')).toBe(true)
    finish({ exitCode: 0 })
    expect((await first).status).toBe('cancelled')
  })

  it('建立沙箱期间取消后不启动命令且释放会话', async () => {
    const { deps, manager, session } = dependencies()
    let ready!: (value: unknown) => void
    manager.createSession.mockImplementation(() => new Promise((resolve) => { ready = resolve }))
    const pending = runShellCommand('test', 'pwd', deps)
    expect(cancelShellCommand('test')).toBe(true)
    ready(session)
    expect((await pending).status).toBe('cancelled')
    expect(exec).not.toHaveBeenCalled()
    expect(manager.destroySession).toHaveBeenCalledWith(session)
  })

  it('超时中断命令并回收沙箱', async () => {
    vi.useFakeTimers()
    const { deps, manager } = dependencies()
    exec.mockImplementation((_command, _cwd, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const pending = runShellCommand('test', 'pwd', deps)
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).status).toBe('timeout')
    expect(manager.destroySession).toHaveBeenCalledOnce()
  })

  it('跨输出分块的中文 UTF-8 不产生乱码', async () => {
    const { deps } = dependencies()
    const bytes = Buffer.from('中文')
    exec.mockImplementation(async (_command, _cwd, options) => {
      options.onData(bytes.subarray(0, 1))
      options.onData(bytes.subarray(1))
      return { exitCode: 0 }
    })
    expect((await runShellCommand('test', 'pwd', deps)).output).toBe('中文')
  })
})

describe('shellCommandStatus', () => {
  it('退出码 0 是成功，非 0 是失败', () => {
    expect(shellCommandStatus({ aborted: false, timedOut: false, failed: false, exitCode: 0 })).toBe('completed')
    expect(shellCommandStatus({ aborted: false, timedOut: false, failed: false, exitCode: 1 })).toBe('failed')
  })

  it('超时优先于终止：超时也是通过 abort 收尾的', () => {
    expect(shellCommandStatus({ aborted: true, timedOut: true, failed: true, exitCode: null })).toBe('timeout')
  })

  it('主动终止不算失败', () => {
    expect(shellCommandStatus({ aborted: true, timedOut: false, failed: true, exitCode: null })).toBe('cancelled')
  })

  it('执行器抛错时是失败', () => {
    expect(shellCommandStatus({ aborted: false, timedOut: false, failed: true, exitCode: null })).toBe('failed')
  })
})

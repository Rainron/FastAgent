import { describe, expect, it, vi } from 'vitest'
import { defaultSandboxSettings, resolveSandboxPolicy } from '../../../../shared/sandbox'
import { createShellOperations, resolveSandboxTimeoutMs, sandboxGitConfigEnv } from '../shell-operations'
import type { SandboxManager } from '../sandbox-manager'
import type { SandboxExecuteRequest, SandboxSession } from '../sandbox-types'

type LocalExecOptions = { onData: (chunk: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: Record<string, string> }
const localExec = vi.hoisted(() => vi.fn(async (_command: string, _cwd: string, _options: { onData: (chunk: Buffer) => void; env?: Record<string, string> }) => ({ exitCode: 0 })))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createLocalBashOperations: () => ({ exec: localExec }),
  createLocalPowerShellOperations: () => ({ exec: localExec })
}))

const policy = resolveSandboxPolicy(defaultSandboxSettings, { workspacePath: 'D:\\work', home: 'C:\\Users\\lake' })

function session(isolation: SandboxSession['isolation']): SandboxSession {
  return { id: 's1', workspacePath: 'D:\\work', accountMode: 'online', policy, isolation, createdAt: 1 }
}

function fakeManager() {
  const calls: SandboxExecuteRequest[] = []
  const manager = {
    execute: vi.fn(async (_session: SandboxSession, request: SandboxExecuteRequest) => {
      calls.push(request)
      request.onData(Buffer.from('ok'), 'stdout')
      return { id: 'p1', exit: Promise.resolve({ exitCode: 0 }) }
    })
  } as unknown as SandboxManager
  return { manager, calls }
}

describe('createShellOperations', () => {
  it('沙箱会话存在时命令走 SandboxManager', async () => {
    localExec.mockClear()
    const { manager, calls } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'bash', session: session('sandboxed'), manager, hostEnv: { PATH: 'C:\\bin' } })
    const chunks: string[] = []
    const result = await operations.exec('npm test', 'D:\\work', { onData: (chunk) => chunks.push(chunk.toString('utf8')) })
    expect(result).toEqual({ exitCode: 0 })
    expect(localExec).not.toHaveBeenCalled()
    expect(calls[0].command).toBe('npm test')
    expect(chunks).toEqual(['ok'])
  })

  it('没有沙箱会话时退回本地执行', async () => {
    localExec.mockClear()
    const { manager } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'powershell', session: null, manager, hostEnv: { PATH: 'C:\\bin' } })
    await operations.exec('git status', 'D:\\work', { onData: () => undefined })
    expect(localExec).toHaveBeenCalledOnce()
  })

  it('降级会话不会误走沙箱通道', async () => {
    localExec.mockClear()
    const { manager } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'bash', session: session('unsandboxed'), manager, hostEnv: {} })
    await operations.exec('ls', '.', { onData: () => undefined })
    expect(localExec).toHaveBeenCalledOnce()
  })

  it('两条路径都清洗环境变量，API Key 不进子进程', async () => {
    localExec.mockClear()
    const hostEnv = { PATH: 'C:\\bin', ANTHROPIC_API_KEY: 'secret', COMPANY_INTERNAL_VAR: 'x' }
    const { manager, calls } = fakeManager()

    const sandboxed = createShellOperations({ shellToolName: 'bash', session: session('sandboxed'), manager, hostEnv })
    await sandboxed.exec('env', 'D:\\work', { onData: () => undefined })
    // 沙箱路径还会追加 GIT_CONFIG_*，只断言宿主环境的取舍结果。
    expect(calls[0].env.PATH).toBe('C:\\bin')
    expect(calls[0].env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(calls[0].env.COMPANY_INTERNAL_VAR).toBeUndefined()

    const local = createShellOperations({ shellToolName: 'bash', session: null, manager, hostEnv })
    await local.exec('env', 'D:\\work', { onData: () => undefined })
    expect((localExec.mock.calls[0]?.[2] as LocalExecOptions | undefined)?.env).toEqual({ PATH: 'C:\\bin' })
  })

  it('沙箱内用 FASTAGENT_SANDBOX_BASH 指定内置 bash：它刻意不在 PATH 上，runner 找不到', async () => {
    const { manager, calls } = fakeManager()
    const bashPath = 'C:\\Users\\me\\.fa\\runtime\\git\\usr\\bin\\bash.exe'
    const operations = createShellOperations({ shellToolName: 'bash', bashPath, session: session('sandboxed'), manager, hostEnv: { PATH: 'C:\\bin' } })
    await operations.exec('ls', 'D:\\work', { onData: () => undefined })
    expect(calls[0].env.FASTAGENT_SANDBOX_BASH).toBe(bashPath)
  })

  it('选 powershell 时不下发 bash 路径', async () => {
    const { manager, calls } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'powershell', bashPath: 'C:\\x\\bash.exe', session: session('sandboxed'), manager, hostEnv: { PATH: 'C:\\bin' } })
    await operations.exec('ls', 'D:\\work', { onData: () => undefined })
    expect(calls[0].env.FASTAGENT_SANDBOX_BASH).toBeUndefined()
  })

  it('沙箱内为工作区登记 git safe.directory：沙箱账户不是仓库属主，否则每条 git 都 128', async () => {
    const { manager, calls } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'bash', session: session('sandboxed'), manager, hostEnv: { PATH: 'C:\\bin' } })
    await operations.exec('git status', 'D:\\work', { onData: () => undefined })
    expect(calls[0].env.GIT_CONFIG_COUNT).toBe('2')
    expect(calls[0].env.GIT_CONFIG_KEY_0).toBe('safe.directory')
    expect(calls[0].env.GIT_CONFIG_VALUE_0).toBe('D:\\work')
    expect(calls[0].env.GIT_CONFIG_VALUE_1).toBe('D:/work')
  })

  it('调用方自带的 GIT_CONFIG_COUNT 会被覆盖，避免索引错位', async () => {
    const { manager, calls } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'bash', session: session('sandboxed'), manager, hostEnv: {} })
    await operations.exec('git status', 'D:\\work', { onData: () => undefined, env: { GIT_CONFIG_COUNT: '7' } })
    expect(calls[0].env.GIT_CONFIG_COUNT).toBe('2')
  })

  it('取消信号与超时透传给沙箱', async () => {
    const controller = new AbortController()
    const { manager, calls } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'bash', session: session('sandboxed'), manager, hostEnv: {} })
    await operations.exec('sleep 100', 'D:\\work', { onData: () => undefined, signal: controller.signal, timeout: 1234 })
    expect(calls[0].signal).toBe(controller.signal)
    expect(calls[0].timeoutMs).toBe(1_234_000)
  })

  it('沙箱超时支持小数秒并四舍五入为整数毫秒', async () => {
    const { manager, calls } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'bash', session: session('sandboxed'), manager, hostEnv: {} })
    await operations.exec('sleep 1.234', 'D:\\work', { onData: () => undefined, timeout: 1.234 })
    expect(calls[0].timeoutMs).toBe(1_234)
  })

  it('沙箱未传显式超时时使用策略毫秒默认值', async () => {
    const { manager, calls } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'bash', session: session('sandboxed'), manager, hostEnv: {} })
    await operations.exec('echo ok', 'D:\\work', { onData: () => undefined })
    expect(calls[0].timeoutMs).toBe(policy.process.timeoutMs)
  })

  it('本地执行分支继续把超时按 Pi 的秒单位传递', async () => {
    localExec.mockClear()
    const { manager } = fakeManager()
    const operations = createShellOperations({ shellToolName: 'bash', session: null, manager, hostEnv: {} })
    await operations.exec('sleep 1', 'D:\\work', { onData: () => undefined, timeout: 1.5 })
    expect((localExec.mock.calls[0]?.[2] as LocalExecOptions | undefined)?.timeout).toBe(1.5)
  })

  it('超时必须是有限正数且换算后不超过 Node 定时器上限', () => {
    expect(resolveSandboxTimeoutMs(undefined)).toBeUndefined()
    expect(() => resolveSandboxTimeoutMs(0)).toThrow(/finite number of seconds/)
    expect(() => resolveSandboxTimeoutMs(-1)).toThrow(/finite number of seconds/)
    expect(() => resolveSandboxTimeoutMs(Number.NaN)).toThrow(/finite number of seconds/)
    expect(() => resolveSandboxTimeoutMs(Number.POSITIVE_INFINITY)).toThrow(/finite number of seconds/)
    expect(() => resolveSandboxTimeoutMs(2_147_483.648)).toThrow(/maximum/)
  })
})

describe('sandboxGitConfigEnv', () => {
  it('没有工作区时不下发任何 git 配置', () => {
    expect(sandboxGitConfigEnv(null)).toEqual({})
  })

  it('POSIX 路径没有反斜杠形态，只登记一条', () => {
    expect(sandboxGitConfigEnv('/home/me/work')).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '/home/me/work'
    })
  })
})

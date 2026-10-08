import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSandboxSettings } from '../../shared/sandbox'
import type { IpcRegistrar, MainContext } from '../app-context'
import { registerShellCommandIpc } from './shell-command'

const { runShellCommand, cancelShellCommand } = vi.hoisted(() => ({ runShellCommand: vi.fn().mockResolvedValue({}), cancelShellCommand: vi.fn() }))
vi.mock('../shell-command', () => ({ runShellCommand, cancelShellCommand }))

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

function setup() {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const ctx = {
    settings: { shellCommand: { enabled: true }, shellPreference: 'powershell', bashPath: '', sandbox: defaultSandboxSettings },
    workspaceRoot: 'C:/other-project', appPaths: { quickWorkspaceDir: 'C:/quick' },
    store: { getConversationRoot: vi.fn().mockReturnValue('C:/worktree'), getConversation: vi.fn().mockReturnValue({ id: 'conversation' }) },
    requireNamespace: () => 'namespace', bundledTools: {}, sandboxManager: {},
    conversationRuntimeCache: { peek: () => null }
  } as unknown as MainContext
  registerShellCommandIpc(((channel, callback) => handlers.set(channel, callback)) as IpcRegistrar, ctx)
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
  return { ctx, run: handlers.get('shell:run-command')!, event: { sender } }
}

describe('shell command IPC', () => {
  it('使用当前会话工作树目录和当前沙箱策略', async () => {
    const { run, event } = setup()
    await run(event, { id: 'test', command: 'pwd', conversationId: 'conversation' })
    expect(runShellCommand).toHaveBeenLastCalledWith('test', 'pwd', expect.objectContaining({ workspaceRoot: 'C:/worktree', policy: expect.objectContaining({ enabled: true }) }))
  })

  it('快速对话使用专用目录', async () => {
    const { run, event, ctx } = setup()
    vi.mocked(ctx.store.getConversationRoot).mockReturnValue(null)
    await run(event, { id: 'test', command: 'pwd', conversationId: 'conversation' })
    expect(runShellCommand).toHaveBeenLastCalledWith('test', 'pwd', expect.objectContaining({ workspaceRoot: 'C:/quick' }))
  })

  it.each([null, {}, { id: '', command: 'pwd' }, { id: 'x', command: ' ' }, { id: 'x', command: 1 }])('拒绝无效请求 %j', async (input) => {
    const { run, event } = setup()
    await expect(Promise.resolve().then(() => run(event, input))).rejects.toThrow('命令请求无效')
  })

  it('设置关闭时不执行命令', async () => {
    const { run, event, ctx } = setup()
    ctx.settings.shellCommand = { enabled: false, output: 'local', timeoutSeconds: 60 }
    await expect(run(event, { id: 'test', command: 'pwd' })).rejects.toThrow('关闭')
    expect(runShellCommand).not.toHaveBeenCalled()
  })

  it('会话不存在时不执行命令', async () => {
    const { run, event, ctx } = setup()
    vi.mocked(ctx.store.getConversation).mockReturnValue(null)
    await expect(run(event, { id: 'test', command: 'pwd', conversationId: 'missing' })).rejects.toThrow('会话不存在')
    expect(runShellCommand).not.toHaveBeenCalled()
  })

  it('窗口销毁会取消命令，结束后解绑监听', async () => {
    const { run, event } = setup()
    let finish!: (value: unknown) => void
    runShellCommand.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = run(event, { id: 'test', command: 'pwd' })
    event.sender.emit('destroyed')
    expect(cancelShellCommand).toHaveBeenCalledWith('test')
    finish({})
    await pending
    expect(event.sender.listenerCount('destroyed')).toBe(0)
  })

  it('高频输出按帧合并，结束前冲刷尾块', async () => {
    vi.useFakeTimers()
    const { run, event } = setup()
    let finish!: (value: unknown) => void
    let output!: (chunk: string) => void
    runShellCommand.mockImplementationOnce((_id, _command, deps) => {
      output = deps.onData
      return new Promise((resolve) => { finish = resolve })
    })
    const pending = run(event, { id: 'test', command: 'pwd' })
    output('一')
    output('二')
    expect(event.sender.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(16)
    expect(event.sender.send).toHaveBeenCalledExactlyOnceWith('shell:command-output', { id: 'test', chunk: '一二' })
    output('三')
    finish({})
    await pending
    expect(event.sender.send).toHaveBeenLastCalledWith('shell:command-output', { id: 'test', chunk: '三' })
    expect(vi.getTimerCount()).toBe(0)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { openTerminalAt, terminalCandidates } from './open-terminal'

describe('terminalCandidates', () => {
  it('Windows 优先 Windows Terminal，退回 cmd', () => {
    const candidates = terminalCandidates('win32', 'K:\\proj my app')
    expect(candidates[0]).toEqual({ command: 'wt.exe', args: ['-d', 'K:\\proj my app'] })
    expect(candidates[1].command).toBe('cmd.exe')
  })

  it('路径作为独立参数传递，不拼进命令字符串', () => {
    // 带空格、& 与引号的目录名不能变成注入点
    const evil = 'K:\\a & b "c"'
    for (const platform of ['win32', 'darwin', 'linux'] as NodeJS.Platform[]) {
      for (const candidate of terminalCandidates(platform, evil)) {
        expect(candidate.command).not.toContain(evil)
        expect(candidate.args).toContain(evil)
      }
    }
  })

  it('macOS 用 open -a Terminal', () => {
    expect(terminalCandidates('darwin', '/tmp/x')).toEqual([{ command: 'open', args: ['-a', 'Terminal', '/tmp/x'] }])
  })

  it('Linux 逐个试常见终端', () => {
    expect(terminalCandidates('linux', '/tmp/x').map((item) => item.command)).toContain('gnome-terminal')
  })
})

describe('openTerminalAt', () => {
  const child = () => ({ unref: vi.fn(), on: vi.fn() })

  it('启动成功返回空串', async () => {
    const spawn = vi.fn(() => child())
    await expect(openTerminalAt('/tmp/x', spawn as never, 'darwin')).resolves.toBe('')
    expect(spawn).toHaveBeenCalledWith('open', ['-a', 'Terminal', '/tmp/x'], { cwd: '/tmp/x', detached: true, stdio: 'ignore' })
  })

  it('第一个候选失败时试下一个', async () => {
    const spawn = vi.fn((command: string) => {
      const handle = child()
      if (command === 'wt.exe') handle.on = vi.fn((_event: string, listener: (error: Error) => void) => listener(new Error('ENOENT')))
      return handle
    })
    await expect(openTerminalAt('C:\\x', spawn as never, 'win32')).resolves.toBe('')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('全部失败时把最后一个错误报出去，而不是静默什么都不做', async () => {
    const spawn = vi.fn(() => {
      const handle = child()
      handle.on = vi.fn((_event: string, listener: (error: Error) => void) => listener(new Error('没装终端')))
      return handle
    })
    await expect(openTerminalAt('/tmp/x', spawn as never, 'darwin')).resolves.toBe('没装终端')
  })

  it('spawn 直接抛错也按失败处理', async () => {
    const spawn = vi.fn(() => { throw new Error('spawn 失败') })
    await expect(openTerminalAt('/tmp/x', spawn as never, 'darwin')).resolves.toBe('spawn 失败')
  })
})

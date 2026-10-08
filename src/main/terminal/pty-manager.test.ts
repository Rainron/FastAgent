import { describe, expect, it, vi } from 'vitest'
import { appendBacklog, TERMINAL_MAX_SESSIONS, TerminalManager, type PtyProcess, type PtySpawnOptions } from './pty-manager'

function fakePty() {
  const listeners: { data: ((chunk: string) => void)[]; exit: ((event: { exitCode: number; signal?: number }) => void)[] } = { data: [], exit: [] }
  const written: string[] = []
  const resized: Array<[number, number]> = []
  const pty: PtyProcess = {
    pid: 4321,
    write: (data) => { written.push(data) },
    resize: (cols, rows) => { resized.push([cols, rows]) },
    kill: vi.fn(),
    onData: (listener) => { listeners.data.push(listener) },
    onExit: (listener) => { listeners.exit.push(listener) }
  }
  return { pty, written, resized, emit: (chunk: string) => listeners.data.forEach((listener) => listener(chunk)), exit: (code: number) => listeners.exit.forEach((listener) => listener({ exitCode: code })) }
}

function manager(overrides: { spawn?: (options: PtySpawnOptions) => PtyProcess } = {}) {
  const spawned: PtySpawnOptions[] = []
  const data: Array<{ id: string; data: string }> = []
  const exits: Array<{ id: string; exitCode: number }> = []
  const fake = fakePty()
  const instance = new TerminalManager({
    spawn: overrides.spawn ?? ((options) => { spawned.push(options); return fake.pty }),
    resolveShell: () => ({ file: 'powershell.exe', args: ['-NoLogo'] }),
    defaultCwd: () => 'C:/home',
    env: () => ({ PATH: 'x' }),
    onData: (chunk) => data.push(chunk),
    onExit: (event) => exits.push(event)
  })
  return { instance, spawned, data, exits, fake }
}

describe('终端会话管理', () => {
  it('按解析出的 shell 与工作区目录拉起会话', () => {
    const { instance, spawned } = manager()
    const session = instance.create({ cwd: 'K:/project', cols: 100, rows: 30 })
    expect(spawned[0]).toMatchObject({ file: 'powershell.exe', args: ['-NoLogo'], cwd: 'K:/project', cols: 100, rows: 30 })
    expect(session.pid).toBe(4321)
    expect(instance.list()).toHaveLength(1)
  })

  it('没给目录时落到默认目录，尺寸非法时回落到 80x24', () => {
    const { instance, spawned } = manager()
    instance.create({ cwd: '  ', cols: Number.NaN, rows: 0 })
    expect(spawned[0]).toMatchObject({ cwd: 'C:/home', cols: 80, rows: 24 })
  })

  it('输出既回放给订阅方也留在缓冲里，重新挂载时补齐', () => {
    const { instance, data, fake } = manager()
    const session = instance.create()
    fake.emit('hello ')
    fake.emit('world')
    expect(data.map((chunk) => chunk.data)).toEqual(['hello ', 'world'])
    expect(instance.attach(session.id)).toEqual({ session: expect.objectContaining({ id: session.id }), backlog: 'hello world' })
  })

  it('退出后清表并通知，attach 返回 null', () => {
    const { instance, exits, fake } = manager()
    const session = instance.create()
    fake.exit(1)
    expect(exits).toEqual([{ id: session.id, exitCode: 1 }])
    expect(instance.list()).toEqual([])
    expect(instance.attach(session.id)).toBeNull()
    expect(() => instance.write(session.id, 'x')).toThrow('终端会话不存在或已结束')
  })

  it('resize 同步给 pty 并更新会话尺寸，尺寸没变时不重复下发', () => {
    const { instance, fake } = manager()
    const session = instance.create({ cols: 80, rows: 24 })
    instance.resize(session.id, 120, 40)
    instance.resize(session.id, 120, 40)
    expect(fake.resized).toEqual([[120, 40]])
    expect(instance.list()[0]).toMatchObject({ cols: 120, rows: 40 })
  })

  it('会话数封顶，挡住反复开终端把机器占满', () => {
    const { instance } = manager({ spawn: () => fakePty().pty })
    for (let index = 0; index < TERMINAL_MAX_SESSIONS; index += 1) instance.create()
    expect(() => instance.create()).toThrow(`最多同时开 ${TERMINAL_MAX_SESSIONS} 个终端`)
  })

  it('关闭不存在的会话返回 false，kill 抛错不外泄', () => {
    const { instance } = manager({ spawn: () => ({ ...fakePty().pty, kill: () => { throw new Error('已退出') } }) })
    const session = instance.create()
    expect(instance.close('nope')).toBe(false)
    expect(instance.close(session.id)).toBe(true)
  })
})

describe('输出缓冲', () => {
  it('超过上限时砍掉最前面的，保留最近输出', () => {
    expect(appendBacklog('abc', 'de', 4)).toBe('bcde')
    expect(appendBacklog('abc', 'd', 10)).toBe('abcd')
  })
})

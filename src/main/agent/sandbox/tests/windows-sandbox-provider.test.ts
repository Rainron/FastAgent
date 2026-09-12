import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WindowsSandboxProvider, type WindowsSandboxPaths } from '../providers/windows-native/windows-sandbox-provider'
import { defaultSandboxSettings, resolveSandboxPolicy } from '../../../../shared/sandbox'

const roots: string[] = []

async function createPaths(): Promise<WindowsSandboxPaths> {
  const root = await mkdtemp(join(tmpdir(), 'fastagent-sandbox-provider-'))
  roots.push(root)
  const stateDir = join(root, 'state')
  mkdirSync(stateDir)
  writeFileSync(join(root, 'runner.exe'), '')
  writeFileSync(join(stateDir, 'setup.json'), JSON.stringify({ version: '0.1.0', offlineSid: 'offline', onlineSid: 'online' }))
  writeFileSync(join(stateDir, 'credentials.bin'), '')
  return { runnerPath: join(root, 'runner.exe'), setupPath: join(root, 'setup.exe'), stateDir, runtimePath: join(root, 'runtime') }
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & Pick<ChildProcess, 'stdout' | 'kill'>
  child.stdout = new EventEmitter() as ChildProcess['stdout']
  child.kill = vi.fn(() => true)
  return child
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('WindowsSandboxProvider', () => {
  it('等待异步版本子进程结束后再返回能力', async () => {
    const paths = await createPaths()
    const child = fakeChild()
    const spawnVersionProbe = vi.fn(() => child as ChildProcess)
    const provider = new WindowsSandboxProvider(paths, 'win32', undefined, spawnVersionProbe)

    let settled = false
    const probing = provider.probe().finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    child.stdout?.emit('data', '0.1.0\n')
    child.emit('close', 0)

    await expect(probing).resolves.toMatchObject({ status: 'ready', runnerVersion: '0.1.0' })
    expect(spawnVersionProbe).toHaveBeenCalledTimes(1)
  })

  it('版本探测超过 5 秒时终止子进程并返回 null', async () => {
    vi.useFakeTimers()
    const paths = await createPaths()
    const child = fakeChild()
    const provider = new WindowsSandboxProvider(paths, 'win32', undefined, () => child as ChildProcess)

    const probing = provider.probe()
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(probing).resolves.toMatchObject({ status: 'broken', runnerVersion: null })
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('版本子进程失败时返回 null', async () => {
    const paths = await createPaths()
    const child = fakeChild()
    const provider = new WindowsSandboxProvider(paths, 'win32', undefined, () => child as ChildProcess)

    const probing = provider.probe()
    child.emit('error', new Error('spawn failed'))

    await expect(probing).resolves.toMatchObject({ status: 'broken', runnerVersion: null })
  })
})

describe('内置工具链授权', () => {
  const policy = resolveSandboxPolicy(defaultSandboxSettings, { workspacePath: null, home: 'C:\\Users\\lake' })

  function grantChild(exitCode: number) {
    const child = fakeChild()
    // 授权进程是同步起停的，交给微任务队列后再抛终态，避免 close 早于监听注册
    queueMicrotask(() => child.emit('close', exitCode))
    return child as ChildProcess
  }

  it('建会话时按只读+执行授权 runtime 目录', async () => {
    const paths = await createPaths()
    const calls: string[][] = []
    const provider = new WindowsSandboxProvider(paths, 'win32', () => ({
      write: () => undefined,
      onData: (listener) => queueMicrotask(() => listener(Buffer.from(`${JSON.stringify({ type: 'ready', session: 's', account: 'a' })}\n`))),
      onClose: () => undefined,
      kill: () => undefined
    }), undefined, {
      spawnGrant: (args) => { calls.push(args); return grantChild(0) }
    })

    await provider.createSession({ workspacePath: null, policy, shell: 'bash' })
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('--grant-runtime')
    expect(calls[0][1]).toBe(paths.runtimePath)
  })

  it('授权失败只降级并提示，不阻断会话建立', async () => {
    const paths = await createPaths()
    const notices: string[] = []
    const provider = new WindowsSandboxProvider(paths, 'win32', () => ({
      write: () => undefined,
      onData: (listener) => queueMicrotask(() => listener(Buffer.from(`${JSON.stringify({ type: 'ready', session: 's', account: 'a' })}\n`))),
      onClose: () => undefined,
      kill: () => undefined
    }), undefined, {
      spawnGrant: () => grantChild(1),
      onNotice: (message) => notices.push(message)
    })

    const session = await provider.createSession({ workspacePath: null, policy, shell: 'bash' })
    expect(session.isolation).toBe('sandboxed')
    expect(notices[0]).toContain('内置工具链授权失败')
  })

  it('未安装内置工具链时不做授权', async () => {
    const paths = { ...await createPaths(), runtimePath: null }
    const calls: string[][] = []
    const provider = new WindowsSandboxProvider(paths, 'win32', () => ({
      write: () => undefined,
      onData: (listener) => queueMicrotask(() => listener(Buffer.from(`${JSON.stringify({ type: 'ready', session: 's', account: 'a' })}\n`))),
      onClose: () => undefined,
      kill: () => undefined
    }), undefined, {
      spawnGrant: (args) => { calls.push(args); return grantChild(0) }
    })

    await provider.createSession({ workspacePath: null, policy, shell: 'bash' })
    expect(calls).toEqual([])
  })
})

import { describe, expect, it, vi } from 'vitest'
import * as subject from './conversation-runtime-cache'

interface Runtime {
  id: string
  dispose: ReturnType<typeof vi.fn>
}

function api() {
  return subject as unknown as {
    ConversationRunCoordinator: new () => {
      run<T>(conversationId: string, task: () => Promise<T>): Promise<T>
    }
    ConversationRuntimeCache: new <T extends { dispose(): void | Promise<void> }>(options?: { capacity?: number; idleMs?: number; now?: () => number }) => {
      get(conversationId: string, signature: string, create: () => Promise<T>): Promise<T>
      getWithStatus(conversationId: string, signature: string, create: () => Promise<T>): Promise<{ value: T; cacheHit: boolean }>
      invalidate(conversationId: string): Promise<void>
      prune(): Promise<void>
      disposeAll(): Promise<void>
    }
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('ConversationRunCoordinator', () => {
  it('同一 conversation 串行执行', async () => {
    const { ConversationRunCoordinator } = api()
    const coordinator = new ConversationRunCoordinator()
    const firstGate = deferred()
    const order: string[] = []
    const first = coordinator.run('c1', async () => {
      order.push('first:start')
      await firstGate.promise
      order.push('first:end')
    })
    const second = coordinator.run('c1', async () => { order.push('second') })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(order).toEqual(['first:start'])
    firstGate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('不同 conversation 允许并行', async () => {
    const { ConversationRunCoordinator } = api()
    const coordinator = new ConversationRunCoordinator()
    const gate = deferred()
    const started: string[] = []
    const first = coordinator.run('c1', async () => { started.push('c1'); await gate.promise })
    const second = coordinator.run('c2', async () => { started.push('c2'); await gate.promise })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(started).toEqual(['c1', 'c2'])
    gate.resolve()
    await Promise.all([first, second])
  })
})

describe('ConversationRunCoordinator 会话隔离', () => {
  it('同会话串行、不同会话并行', async () => {
    const { ConversationRunCoordinator } = await import('./conversation-runtime-cache')
    const coordinator = new ConversationRunCoordinator()
    let release!: () => void
    const first = coordinator.run('a', () => new Promise<void>((resolve) => { release = resolve }))
    let secondStarted = false
    const second = coordinator.run('a', async () => { secondStarted = true })
    const other = coordinator.run('b', async () => undefined)
    await other
    expect(secondStarted).toBe(false)
    release()
    await Promise.all([first, second])
    expect(secondStarted).toBe(true)
  })
})

describe('ConversationRuntimeCache', () => {
  function runtime(id: string): Runtime {
    return { id, dispose: vi.fn(async () => undefined) }
  }

  it('相同 conversation 与配置签名复用实例', async () => {
    const { ConversationRuntimeCache } = api()
    const cache = new ConversationRuntimeCache<Runtime>()
    const create = vi.fn(async () => runtime('one'))
    const first = await cache.get('c1', 'sig-a', create)
    const second = await cache.get('c1', 'sig-a', create)
    expect(second).toBe(first)
    expect(create).toHaveBeenCalledTimes(1)
    await cache.disposeAll()
  })

  it('返回是否命中缓存供阶段埋点使用', async () => {
    const { ConversationRuntimeCache } = api()
    const cache = new ConversationRuntimeCache<Runtime>()
    const create = vi.fn(async () => runtime('one'))
    expect((await cache.getWithStatus('c1', 'sig', create)).cacheHit).toBe(false)
    expect((await cache.getWithStatus('c1', 'sig', create)).cacheHit).toBe(true)
    await cache.disposeAll()
  })

  it('配置签名变化时释放旧实例并重建', async () => {
    const { ConversationRuntimeCache } = api()
    const cache = new ConversationRuntimeCache<Runtime>()
    const old = runtime('old')
    const next = runtime('next')
    await cache.get('c1', 'sig-a', async () => old)
    expect(await cache.get('c1', 'sig-b', async () => next)).toBe(next)
    expect(old.dispose).toHaveBeenCalledTimes(1)
    await cache.disposeAll()
  })

  it('显式失效释放 conversation 实例', async () => {
    const { ConversationRuntimeCache } = api()
    const cache = new ConversationRuntimeCache<Runtime>()
    const value = runtime('one')
    await cache.get('c1', 'sig', async () => value)
    await cache.invalidate('c1')
    expect(value.dispose).toHaveBeenCalledTimes(1)
  })

  it('容量淘汰最久未使用的实例', async () => {
    const { ConversationRuntimeCache } = api()
    let now = 0
    const cache = new ConversationRuntimeCache<Runtime>({ capacity: 2, now: () => ++now })
    const one = runtime('one')
    const two = runtime('two')
    const three = runtime('three')
    await cache.get('c1', 'sig', async () => one)
    await cache.get('c2', 'sig', async () => two)
    await cache.get('c3', 'sig', async () => three)
    expect(one.dispose).toHaveBeenCalledTimes(1)
    expect(two.dispose).not.toHaveBeenCalled()
    await cache.disposeAll()
  })

  it('空闲淘汰释放超时实例', async () => {
    const { ConversationRuntimeCache } = api()
    let now = 0
    const cache = new ConversationRuntimeCache<Runtime>({ idleMs: 100, now: () => now })
    const value = runtime('one')
    await cache.get('c1', 'sig', async () => value)
    now = 101
    await cache.prune()
    expect(value.dispose).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it } from 'vitest'
import { RunScheduler } from './run-scheduler'

describe('RunScheduler', () => {
  it('不同会话并行、同一会话串行', async () => {
    const scheduler = new RunScheduler({ maxConcurrent: 2 })
    let running = 0
    let peak = 0
    const task = (conversationId: string) => scheduler.schedule({ conversationId, provider: 'openai', modelId: 1 }, async () => {
      running += 1; peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 10))
      running -= 1
    })
    await Promise.all([task('a'), task('a'), task('b')])
    expect(peak).toBe(2)
  })

  it('遵守 provider 与 model 的并发限制', async () => {
    const scheduler = new RunScheduler({ maxConcurrent: 4, providerLimits: { openai: 1 }, modelLimits: { 'openai:1': 1 } })
    let running = 0
    let peak = 0
    const task = () => scheduler.schedule({ conversationId: crypto.randomUUID(), provider: 'openai', modelId: 1 }, async () => {
      running += 1; peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
    })
    await Promise.all([task(), task(), task()])
    expect(peak).toBe(1)
  })

  it('排队任务可在执行前取消', async () => {
    const scheduler = new RunScheduler({ maxConcurrent: 1 })
    let resolveFirst!: () => void
    const first = scheduler.schedule({ conversationId: 'a', provider: 'openai', modelId: 1 }, () => new Promise<void>((resolve) => { resolveFirst = resolve }))
    const second = scheduler.schedule({ conversationId: 'b', provider: 'openai', modelId: 1 }, async () => { throw new Error('不应执行') })
    second.cancel()
    resolveFirst()
    await first
    await expect(second.promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

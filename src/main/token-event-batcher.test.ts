import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../shared/types'
import * as subject from './token-event-batcher'

function api() {
  return subject as unknown as {
    createTokenEventBatcher(send: (event: AgentEvent) => void, intervalMs?: number): {
      emit(event: AgentEvent): void
      flush(): void
      dispose(): void
    }
  }
}

function event(type: AgentEvent['type'], text?: string): AgentEvent {
  return { runId: 'r1', turnId: 't1', type, text } as AgentEvent
}

describe('主进程 token event batcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('16ms 内同一 run 的多个 delta 合并发送', () => {
    const sent: AgentEvent[] = []
    const batcher = api().createTokenEventBatcher((item) => sent.push(item), 16)
    batcher.emit(event('token', 'a'))
    batcher.emit(event('token', 'b'))
    batcher.emit(event('token', 'c'))
    expect(sent).toEqual([])
    vi.advanceTimersByTime(16)
    expect(sent).toEqual([event('token', 'abc')])
  })

  it('非 token 与终态事件前先 flush 积压文本', () => {
    const sent: AgentEvent[] = []
    const batcher = api().createTokenEventBatcher((item) => sent.push(item), 16)
    batcher.emit(event('token', 'answer'))
    batcher.emit(event('run_phase'))
    batcher.emit(event('token', '!'))
    batcher.emit(event('completed', 'answer!'))
    expect(sent.map((item) => [item.type, item.text])).toEqual([
      ['token', 'answer'], ['run_phase', undefined], ['token', '!'], ['completed', 'answer!']
    ])
  })

  it('dispose 会 flush 尾段并取消定时器', () => {
    const sent: AgentEvent[] = []
    const batcher = api().createTokenEventBatcher((item) => sent.push(item), 16)
    batcher.emit(event('token', 'tail'))
    batcher.dispose()
    expect(sent).toEqual([event('token', 'tail')])
    vi.advanceTimersByTime(32)
    expect(sent).toHaveLength(1)
  })
})

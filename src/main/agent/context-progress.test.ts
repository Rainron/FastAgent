import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTrailingThrottle } from './context-progress'

describe('createTrailingThrottle', () => {
  afterEach(() => vi.useRealTimers())

  it('立即发送首个值，并在窗口末尾只发送最新值', () => {
    vi.useFakeTimers()
    const sink = vi.fn()
    const reporter = createTrailingThrottle(250, sink)

    reporter.push(1)
    reporter.push(2)
    reporter.push(3)
    expect(sink.mock.calls).toEqual([[1]])
    vi.advanceTimersByTime(250)
    expect(sink.mock.calls).toEqual([[1], [3]])
  })

  it('flush 强制发送最新值且不会再被定时器重复发送', () => {
    vi.useFakeTimers()
    const sink = vi.fn()
    const reporter = createTrailingThrottle(250, sink)
    reporter.push('a')
    reporter.push('b')

    reporter.flush()
    vi.advanceTimersByTime(300)

    expect(sink.mock.calls).toEqual([['a'], ['b']])
  })
})

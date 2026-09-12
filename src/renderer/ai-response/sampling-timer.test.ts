import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleTextSampling } from './sampling-timer'

describe('scheduleTextSampling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('非流式消息不建立采样定时器', () => {
    const sample = vi.fn()
    const cancel = scheduleTextSampling(false, sample, 300)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(600)
    expect(sample).not.toHaveBeenCalled()
    cancel()
  })

  it('流式消息按间隔采样并可清理', () => {
    const sample = vi.fn()
    const cancel = scheduleTextSampling(true, sample, 300)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(300)
    expect(sample).toHaveBeenCalledTimes(1)
    cancel()
    vi.advanceTimersByTime(300)
    expect(sample).toHaveBeenCalledTimes(1)
  })
})
